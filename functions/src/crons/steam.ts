import axios from 'axios';
import {pubsub, config as getConfig, firestore, logger} from 'firebase-functions';
import {SteamFriends, db} from '../firestore.js';
import {webClient as slack} from '../slack.js';

const config = getConfig();

interface GetFriendListResponse {
	friendslist: {
		friends: {
			steamid: string,
		}[],
	},
}

interface GetPlayerSummariesResponse {
	response: {
		players: {
			steamid: string,
			personaname: string,
			profileurl: string,
			avatar: string,
			avatarmedium: string,
			avatarfull: string,
			personastate: number,
			gameid?: number,
			gameextrainfo?: string,
		}[],
	};
}

export const updateSteamFriendsCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	logger.info('updateSteamFriendsCronJob started');

	const {data: friends} = await axios<GetFriendListResponse>('https://api.steampowered.com/ISteamUser/GetFriendList/v1', {
		params: {
			key: config.steam.api_key,
			steamid: config.steam.hakatashi_id,
			relationship: 'friend',
			format: 'json',
		},
	});

	const steamIds = friends.friendslist.friends.map((friend) => friend.steamid);

	logger.info(`Fetched ${steamIds.length} friends`);

	const {data: players} = await axios<GetPlayerSummariesResponse>('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2', {
		params: {
			key: config.steam.api_key,
			steamids: steamIds.join(','),
			format: 'json',
		},
	});

	logger.info(`Fetched ${players.response.players.length} players`);

	const batch = db.batch();

	for (const player of players.response.players) {
		const doc = SteamFriends.doc(player.steamid);
		batch.set(doc, player);
	}

	await batch.commit();

	logger.info('updateSteamFriendsCronJob finished');
});

interface GameStat {
	name: string,
	defaultvalue: number,
	displayName: string,
}

interface PlayerStat {
	name: string,
	value: number,
}

export const onSteamFriendStatusChanged = firestore.document('steam-friends/{steamId}').onUpdate(async (change) => {
	logger.info('onSteamFriendStatusChanged started');

	const before = change.before.data();
	const after = change.after.data();

	logger.info(`before.gameid: ${before?.gameid}`);
	logger.info(`after.gameid: ${after?.gameid}`);

	if (before?.gameid !== after?.gameid && after?.gameid) {
		logger.info(`Game changed: ${before?.gameid} -> ${after?.gameid}`);

		const {data: gameSchema} = await axios('https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2', {
			params: {
				key: config.steam.api_key,
				appid: after.gameid,
				l: 'japanese',
				format: 'json',
			},
		});

		const gameStats: GameStat[] = gameSchema?.game?.availableGameStats?.stats ?? [];
		const gameName: string = gameSchema?.game?.gameName ?? after?.gameextrainfo;

		logger.info(`Fetched game stats: ${gameStats.length}`);

		const {data: userStats} = await axios('https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2', {
			params: {
				key: config.steam.api_key,
				steamid: after.steamid,
				appid: after.gameid,
				format: 'json',
			},
		});

		const playerStats: PlayerStat[] = userStats?.playerstats?.stats ?? [];

		logger.info(`Fetched player stats: ${playerStats.length}`);

		const mergedPlayerStats = playerStats.map((stat) => {
			const gameStat = gameStats.find((gs) => gs.name === stat.name);
			return {
				name: stat.name,
				value: stat.value,
				displayName: gameStat?.displayName ?? stat.name,
			};
		});

		const message = `＊${after.personaname}＊が＊${gameName}＊をプレイ中`;

		const fields = mergedPlayerStats.map((stat) => ({
			type: 'plain_text' as const,
			text: `${stat.displayName}: ${stat.value}`,
			emoji: true,
		}));

		logger.info(`Posting message: ${message}`);

		const postedMessage = await slack.chat.postMessage({
			// eslint-disable-next-line no-underscore-dangle, private-props/no-use-outside
			channel: config.slack.channels._hakatashi,
			text: message,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: message,
					},
					...(fields.length > 0 ? {fields} : {}),
				},
			],
		});

		logger.info(`Posted message: ${postedMessage.ts}`);
	}
});
