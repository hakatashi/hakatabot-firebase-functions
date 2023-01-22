/* eslint-disable import/no-named-as-default-member */

import dayjs from 'dayjs';
import {logger, pubsub} from 'firebase-functions';
import {SANDBOX_ID} from '../const';
import {FitbitTokens, State} from '../firestore';
import * as fitbit from '../fitbit';
import {webClient as slack} from '../slack';
import sleepScorePredicter from './lib/sleep';

interface Rank {
	username: string,
	avatar: string,
	score: number | null,
	wakeTime: string | null,
	rank?: number,
}

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
			const profileResponse = await fitbit.get('/1/user/-/profile.json', {}, token.id);
			const username = profileResponse?.user?.displayName ?? 'No Name';

			if (optoutUsers.includes(username)) {
				continue;
			}

			logger.info('Getting fitbit activities...');
			const sleepsResponse = await fitbit.get('/1.2/user/-/sleep/list.json', {
				beforeDate: '2100-01-01',
				sort: 'desc',
				limit: 100,
				offset: 0,
			}, token.id);

			logger.info(`Retrieved ${sleepsResponse.sleep.length} sleeps by ${username}`);
			const today = dayjs().tz('Asia/Tokyo');

			const sleep = sleepsResponse.sleep.find((s: any) => {
				const day = dayjs.tz(s.endTime, 'Asia/Tokyo');
				return today.isSame(day, 'day') && s.isMainSleep;
			});

			if (!sleep) {
				sleepScores.push({
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
				username: username as string,
				avatar: profileResponse?.user?.avatar as string ?? '',
				score,
				wakeTime: dayjs.tz(sleep.endTime, 'Asia/Tokyo').format('HH:mm'),
			});
		}

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
			blocks: [
				{
					type: 'header',
					text: {
						type: 'plain_text',
						text: '本日の睡眠ランキング',
						emoji: true,
					},
				},
				...sleepScores.map((sleep) => ({
					type: 'section',
					text: {
						type: 'mrkdwn',
						text: sleep.score === null
							? `${sleep.rank}位 ${getUsernameText(sleep.username)}\n起床失敗:cry:`
							: `${sleep.rank}位 ${getUsernameText(sleep.username)}\n推定睡眠スコア: ${Math.round(sleep.score)}点\n起床時刻: ${sleep.wakeTime}`,
					},
					accessory: {
						type: 'image',
						image_url: sleep.avatar,
						alt_text: sleep.username,
					},
				})),
			],
		});
	});
