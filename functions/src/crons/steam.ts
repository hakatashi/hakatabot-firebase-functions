import axios from 'axios';
import {config as getConfig} from 'firebase-functions';
import {info as logInfo, error as logError} from 'firebase-functions/logger';
import {onDocumentUpdated} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
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

export const updateSteamFriendsCronJob = onSchedule('every 5 minutes', async () => {
	logInfo('updateSteamFriendsCronJob started');

	const {data: friends} = await axios<GetFriendListResponse>('https://api.steampowered.com/ISteamUser/GetFriendList/v1', {
		params: {
			key: config.steam.api_key,
			steamid: config.steam.hakatashi_id,
			relationship: 'friend',
			format: 'json',
		},
	});

	const steamIds = friends.friendslist.friends.map((friend) => friend.steamid);

	logInfo(`Fetched ${steamIds.length} friends`);

	const {data: players} = await axios<GetPlayerSummariesResponse>('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2', {
		params: {
			key: config.steam.api_key,
			steamids: steamIds.join(','),
			format: 'json',
		},
	});

	logInfo(`Fetched ${players.response.players.length} players`);

	const batch = db.batch();

	for (const player of players.response.players) {
		const doc = SteamFriends.doc(player.steamid);
		batch.set(doc, player);
	}

	await batch.commit();

	logInfo('updateSteamFriendsCronJob finished');
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

export const onSteamFriendStatusChanged = onDocumentUpdated('steam-friends/{steamId}', async (change) => {
	logInfo('onSteamFriendStatusChanged started');

	const before = change.data?.before.data();
	const after = change.data?.after.data();

	logInfo(`before.gameid: ${before?.gameid}`);
	logInfo(`after.gameid: ${after?.gameid}`);

	if (before?.gameid !== after?.gameid && after?.gameid) {
		logInfo(`Game changed: ${before?.gameid} -> ${after?.gameid}`);

		let gameName: string | undefined = after?.gameextrainfo;
		let mergedPlayerStats: (PlayerStat & {displayName: string})[] = [];

		try {
			const {data: gameSchema} = await axios('https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2', {
				params: {
					key: config.steam.api_key,
					appid: after.gameid,
					l: 'japanese',
					format: 'json',
				},
			});

			const gameStats: GameStat[] = gameSchema?.game?.availableGameStats?.stats ?? [];
			if (gameSchema?.game?.gameName) {
				gameName = gameSchema?.game?.gameName;
			}

			logInfo(`Fetched game stats: ${gameStats.length}`);

			const {data: userStats} = await axios('https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v2', {
				params: {
					key: config.steam.api_key,
					steamid: after.steamid,
					appid: after.gameid,
					format: 'json',
				},
			});

			const playerStats: PlayerStat[] = userStats?.playerstats?.stats ?? [];

			logInfo(`Fetched player stats: ${playerStats.length}`);

			mergedPlayerStats = playerStats.map((stat) => {
				const gameStat = gameStats.find((gs) => gs.name === stat.name);
				return {
					name: stat.name,
					value: stat.value,
					displayName: gameStat?.displayName ?? stat.name,
				};
			});
		} catch (error) {
			logError('Failed to fetch game stats', error);
		}

		const appUrl = `https://store.steampowered.com/app/${after.gameid}`;
		const gameLink = `<${appUrl}|${gameName}>`;
		const userLink = `<${after.profileurl}|${after.personaname}>`;

		const message = `＊${userLink}＊が＊${gameLink}＊をプレイ中`;

		const fields = mergedPlayerStats.map((stat) => ({
			type: 'plain_text' as const,
			text: `${stat.displayName}: ${stat.value}`,
			emoji: true,
		}));

		logInfo(`Posting message: ${message}`);

		const postedMessage = await slack.chat.postMessage({
			// eslint-disable-next-line no-underscore-dangle, private-props/no-use-outside
			channel: config.slack.channels._hakatashi,
			text: message,
			icon_url: after.avatarfull,
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

		logInfo(`Posted message: ${postedMessage.ts}`);
	}
});
