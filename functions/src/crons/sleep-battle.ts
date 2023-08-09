/* eslint-disable import/no-named-as-default-member */

import dayjs from 'dayjs';
import {logger, pubsub} from 'firebase-functions';
import {SANDBOX_ID} from '../const';
import {FitbitTokens, State} from '../firestore';
import * as fitbit from '../fitbit';
import {webClient as slack} from '../slack';
import sleepScorePredicter from './lib/sleep';

interface UserRank {
	type: 'user',
	username: string,
	avatar: string,
	score: number | null,
	wakeTime: string | null,
	rank?: number,
}

interface DividerRank {
	type: 'divider',
	score: number,
}

type Rank = UserRank | DividerRank;

const getScoreEmoji = (score: number) => {
	if (score >= 90) {
		return ':trophy:';
	}
	if (score >= 80) {
		return ':star:';
	}
	return '';
};

export const sleepBattleCronJob = pubsub
	.schedule('0 12 * * *')
	.timeZone('Asia/Tokyo')
	.onRun(async () => {
		const state = new State('sleep-battle-cron-job');
		const optoutUsers = await state.get('optoutUsers', [] as string[]);
		const slackUsers = await state.get(
			'slackUsers',
			Object.create(null) as {[slackId: string]: string},
		);

		const slackUsersMap = new Map(Object.entries(slackUsers).map(([slackId, fitbitId]) => [fitbitId, slackId]));

		const fitbitTokens = await FitbitTokens.get();
		const sleepScores = [] as Rank[];

		for (const token of fitbitTokens.docs) {
			logger.info(`Getting fitbit profile of ${token.id}...`);
			const profileResponse = await fitbit.get('/1/user/-/profile.json', {}, token.id);
			const username = profileResponse?.user?.displayName ?? 'No Name';

			if (optoutUsers.includes(username)) {
				continue;
			}

			logger.info(`Getting fitbit activities of ${username}...`);
			const sleepsResponse = await fitbit.get('/1.2/user/-/sleep/list.json', {
				beforeDate: '2100-01-01',
				sort: 'desc',
				limit: 100,
				offset: 0,
			}, token.id);

			logger.info(`Retrieved ${sleepsResponse.sleep.length} sleeps by ${username}`);
			const today = dayjs().tz('Asia/Tokyo');

			const sleep = sleepsResponse.sleep.reverse().find((s: any) => {
				const day = dayjs.tz(s.endTime, 'Asia/Tokyo');
				return today.isSame(day, 'day') && s.isMainSleep;
			});

			if (!sleep) {
				sleepScores.push({
					type: 'user',
					username: username as string,
					avatar: profileResponse?.user?.avatar as string ?? '',
					score: null,
					wakeTime: null,
				});
				continue;
			}

			const minutesRemSleep = sleep?.levels?.summary?.rem?.minutes ?? 0;
			const minutesLightSleep = sleep?.levels?.summary?.light?.minutes ?? 0;
			const minutesDeepSleep = sleep?.levels?.summary?.deep?.minutes ?? 0;
			const awakenings = sleep?.levels?.summary?.wake?.count ?? 0;
			const {minutesAsleep, minutesAwake, timeInBed} = sleep;

			const data = [
				minutesAsleep,
				minutesAwake,
				awakenings,
				timeInBed,
				minutesRemSleep,
				minutesLightSleep,
				minutesDeepSleep,
			];

			const [score] = sleepScorePredicter.predict(data);
			sleepScores.push({
				type: 'user',
				username: username as string,
				avatar: profileResponse?.user?.avatar as string ?? '',
				score,
				wakeTime: dayjs.tz(sleep.endTime, 'Asia/Tokyo').format('HH:mm'),
			});
		}

		sleepScores.push({type: 'divider', score: 72});

		sleepScores.sort((a, b) => {
			if (a.score === null && b.score === null) {
				return 0;
			}
			if (a.score === null && b.score !== null) {
				return 1;
			}
			if (a.score !== null && b.score === null) {
				return -1;
			}
			return b.score! - a.score!;
		});

		logger.info(sleepScores);

		let rank = 1;
		for (const sleep of sleepScores) {
			if (sleep.type !== 'user') {
				continue;
			}
			sleep.rank = rank;
			if (sleep.score !== null) {
				rank++;
			}
		}

		const getUsernameText = (username: string) => {
			if (slackUsersMap.has(username)) {
				return `<@${slackUsersMap.get(username)}>`;
			}
			return `＊${username}＊`;
		};

		await slack.chat.postMessage({
			as_user: true,
			channel: SANDBOX_ID,
			text: '本日の睡眠ランキング',
			unfurl_links: false,
			unfurl_media: false,
			blocks: [
				{
					type: 'header',
					text: {
						type: 'plain_text',
						text: '本日の睡眠ランキング',
						emoji: true,
					},
				},
				...sleepScores.map((sleep) => (
					sleep.type === 'user' ? [
						{
							type: 'section',
							text: {
								type: 'mrkdwn',
								text: sleep.score === null
									? `${sleep.rank}位 ${getUsernameText(sleep.username)}\n起床失敗:cry:`
									: `${sleep.rank}位 ${getUsernameText(sleep.username)}\n推定睡眠スコア: ${Math.round(sleep.score)}点${getScoreEmoji(sleep.score)}\n起床時刻: ${sleep.wakeTime}`,
							},
							accessory: {
								type: 'image',
								image_url: sleep.avatar,
								alt_text: sleep.username,
							},
						},
					] : [
						{
							type: 'context',
							elements: [
								{
									type: 'plain_text',
									text: `合格ライン (${sleep.score}点)`,
									emoji: true,
								},
							],
						},
						{
							type: 'divider',
						},
					])).flat(),
				{
					type: 'divider',
				},
				{
					type: 'context',
					elements: [
						{
							type: 'mrkdwn',
							text: '<https://scrapbox.io/tsg/%E7%9D%A1%E7%9C%A0%E3%83%A9%E3%83%B3%E3%82%AD%E3%83%B3%E3%82%B0|このBOTについて>',
						},
					],
				},
			],
		});
	});
