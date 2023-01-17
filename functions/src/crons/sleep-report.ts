/* eslint-disable import/no-named-as-default-member */

import axios from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {logger, pubsub} from 'firebase-functions';
import {get} from 'lodash';
import {EXPIRATION_WINDOW_IN_SECONDS, HAKATASHI_FITBIT_ID, SANDBOX_ID} from '../const';
import {FitbitSleeps, FitbitTokens} from '../firestore';
import {client} from '../fitbit';
import {webClient as slack} from '../slack';

dayjs.extend(utc);
dayjs.extend(timezone);

export const sleepGetCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	if (dayjs().tz('Asia/Tokyo').hour() >= 10) {
		return;
	}

	const hakatashiTokensData = await FitbitTokens.doc(HAKATASHI_FITBIT_ID).get();

	if (!hakatashiTokensData.exists) {
		logger.error('hakatashi token not found');
		return;
	}

	const hakatashiTokens = hakatashiTokensData.data()!;
	hakatashiTokens.expires_at = hakatashiTokens.expires_at.toDate();

	let accessToken = client.createToken(hakatashiTokens as any);

	if (accessToken.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
		logger.info('Refreshing token...');
		accessToken = await accessToken.refresh();
		await FitbitTokens.doc(HAKATASHI_FITBIT_ID).set(accessToken.token, {merge: true});
	}

	logger.info('Getting fitbit activities...');
	const res = await axios.get('https://api.fitbit.com/1.2/user/-/sleep/list.json', {
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

	logger.info(`Retrieved ${res.data.sleep.length} sleeps`);
	for (const sleep of res.data.sleep) {
		const key = sleep.logId.toString();
		const doc = await FitbitSleeps.doc(key).get();
		if (!doc.exists) {
			const wake = get(sleep, ['levels', 'summary', 'wake', 'minutes'], 0);
			const rem = get(sleep, ['levels', 'summary', 'rem', 'minutes'], 0);
			const light = get(sleep, ['levels', 'summary', 'light', 'minutes'], 0);
			const deep = get(sleep, ['levels', 'summary', 'deep', 'minutes'], 0);

			const imageUrl = new URL(`https://image-charts.com/chart?${new URLSearchParams({
				chbr: '0',
				chco: 'e73360,7ec4ff,3f8dff,154ba6',
				chd: `a:${wake}|${rem}|${light}|${deep}`,
				chdlp: 'r',
				chma: '-100,-100,-100,-100',
				chs: '700x10',
				cht: 'bhs',
			})}`);

			await slack.chat.postMessage({
				as_user: true,
				channel: SANDBOX_ID,
				text: 'あさ！',
				blocks: [
					{
						type: 'image',
						block_id: 'image',
						image_url: imageUrl.toString(),
						alt_text: `睡眠統計 (覚醒: ${wake}分, レム睡眠: ${rem}分, 浅い睡眠: ${light}分, 深い睡眠: ${deep}分)`,
					},
					{
						type: 'section',
						text: {
							type: 'plain_text',
							text: 'あさ！',
							emoji: true,
						},
					},
				],
			});
		}
		await FitbitSleeps.doc(key).set(sleep, {merge: true});
	}
});
