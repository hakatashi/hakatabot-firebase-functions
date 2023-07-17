/* eslint-disable import/no-named-as-default-member */

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {logger, pubsub} from 'firebase-functions';
import {get} from 'lodash';
import {SANDBOX_ID} from '../const';
import {FitbitSleeps} from '../firestore';
import * as fitbit from '../fitbit';
import {webClient as slack} from '../slack';

dayjs.extend(utc);
dayjs.extend(timezone);

export const sleepGetCronJob = pubsub.schedule('every 5 minutes').onRun(async (event) => {
	if (dayjs().tz('Asia/Tokyo').hour() >= 10) {
		return;
	}

	logger.info('Getting fitbit activities...');
	const res = await fitbit.get('/1.2/user/-/sleep/list.json', {
		beforeDate: '2100-01-01',
		sort: 'desc',
		limit: 100,
		offset: 0,
	});

	const now = new Date(event.timestamp);
	const threshold = new Date(now.getTime() - 6 * 60 * 60 * 1000);

	logger.info(`Retrieved ${res.sleep.length} sleeps`);
	for (const sleep of res.sleep) {
		if (new Date(sleep.endTime) < threshold) {
			logger.info(`Skipping sleep ${sleep.logId} because it's too old`);
			continue;
		}

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
