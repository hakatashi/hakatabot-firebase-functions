/* eslint-disable import/no-named-as-default-member */

import axios from 'axios';
import dayjs from 'dayjs';
import {logger, pubsub} from 'firebase-functions';
import {EXPIRATION_WINDOW_IN_SECONDS, SANDBOX_ID} from '../const';
import {FitbitTokens, State} from '../firestore';
import {client} from '../fitbit';
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

		const fitbitTokens = await FitbitTokens.get();
		const sleepScores = [] as Rank[];

		for (const token of fitbitTokens.docs) {
			const tokens = token.data();

			tokens.expires_at = tokens.expires_at.toDate();

			let accessToken = client.createToken(tokens as any);

			if (accessToken.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
				logger.info('Refreshing token...');
				accessToken = await accessToken.refresh();
				await FitbitTokens.doc(tokens.user_id).set(accessToken.token, {merge: true});
			}

			const profileResponse = await axios.get('https://api.fitbit.com/1/user/-/profile.json', {
				headers: {
					Authorization: `Bearer ${accessToken.token.access_token}`,
				},
			});
			const username = profileResponse?.data?.user?.displayName ?? 'No Name';

			if (optoutUsers.includes(username)) {
				continue;
			}

			logger.info('Getting fitbit activities...');
			const sleepsResponse = await axios.get('https://api.fitbit.com/1.2/user/-/sleep/list.json', {
				params: {
					beforeDate: '2100-01-01',
					sort: 'desc',
					limit: 100,
					offset: 0,
				},
				headers: {
					Authorization: `Bearer ${accessToken.token.access_token}`,
				},
			});

			logger.info(`Retrieved ${sleepsResponse.data.sleep.length} sleeps by ${username}`);
			const today = dayjs().tz('Asia/Tokyo').subtract(2, 'day');

			const sleep = sleepsResponse.data.sleep.find((s: any) => {
				const day = dayjs.tz(s.endTime, 'Asia/Tokyo');
				return today.isSame(day, 'day') && s.isMainSleep;
			});

			if (!sleep) {
				sleepScores.push({
					username: username as string,
					avatar: profileResponse?.data?.user?.avatar as string ?? '',
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
				avatar: profileResponse?.data?.user?.avatar as string ?? '',
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
							? `${sleep.rank}位 ＊${sleep.username}＊\n起床失敗:cry:`
							: `${sleep.rank}位 ＊${sleep.username}＊\n推定睡眠スコア: ${Math.round(sleep.score)}点\n起床時刻: ${sleep.wakeTime}`,
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
