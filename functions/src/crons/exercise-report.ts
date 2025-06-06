import {stripIndent} from 'common-tags';
import dayjs from 'dayjs';
import {info as logInfo} from 'firebase-functions/logger';
import {onDocumentWritten} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import last from 'lodash/last.js';
import {FITNESS_ID} from '../const.js';
import {AnimeWatchRecords, FitbitActivities} from '../firestore.js';
import {get} from '../fitbit.js';
import {webClient as slack} from '../slack.js';

export const exerciseGetCronJob = onSchedule('every 15 minutes', async (event) => {
	logInfo('Getting fitbit activities...');
	const res = await get('/1/user/-/activities/list.json', {
		afterDate: '1970-01-01',
		sort: 'desc',
		limit: 100,
		offset: 0,
	});

	logInfo(`Retrieved ${res.activities.length} activities`);
	const now = new Date(event.scheduleTime);
	const threshold = new Date(now.getTime() - 60 * 60 * 1000);
	for (const activity of res.activities) {
		if (new Date(activity.lastModified) < threshold) {
			logInfo(`Skipping activity ${activity.logId} because it's too old`);
			continue;
		}
		await FitbitActivities.doc(activity.logId.toString()).set(activity, {merge: true});
	}
});

export const exercisePostCronJob = onDocumentWritten('fitbit-activities/{logId}', async () => {
	const now = Date.now();
	const thresholdTime = now - 5 * 60 * 1000;

	const activitiesResults = await FitbitActivities.orderBy('startTime', 'desc').limit(100).get();
	for (const activityDoc of activitiesResults.docs) {
		if (activityDoc.get('isPosted')) {
			continue;
		}

		if (activityDoc.get('activityName') !== 'Spinning') {
			continue;
		}

		const startTime = new Date(activityDoc.get('startTime')).getTime();
		const duration = activityDoc.get('duration');
		const endTime = startTime + duration;

		if (endTime < thresholdTime) {
			const animeWatchRecord = await AnimeWatchRecords.orderBy('date', 'desc').limit(1).get();

			let animeInfo = '';
			if (!animeWatchRecord.empty) {
				const record = animeWatchRecord.docs[0];
				const date = record.get('date');
				if (date >= now - 60 * 60 * 1000) {
					const animeName = record.get('name');
					const animePart = record.get('part');
					const animePartId = record.get('partId');
					const animeWork = record.get('work');
					const animeWorkId = record.get('workId');
					const animeUrl = `https://animestore.docomo.ne.jp/animestore/ci_pc?workId=${animeWorkId}&partId=${animePartId}`;

					animeInfo = `(+${animeWork} <${animeUrl}|${animePart}「${animeName}」>)`;
				}
			}

			const today = dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
			const weightsResponse = await get(`/1/user/-/body/log/weight/date/${today}/1m.json`, {});
			const latestWeight = (last(weightsResponse?.weight ?? []) as any)?.weight;

			const rawExerciseMinutes = duration / 60 / 1000;
			const exerciseMinutes = Math.floor(rawExerciseMinutes);
			const calories = activityDoc.get('calories');
			const distance = (calories / 20).toFixed(2);
			const averageHeartRate = activityDoc.get('averageHeartRate');

			const mets = latestWeight ? calories / rawExerciseMinutes * 60 / latestWeight : null;
			const metsString = mets ? ` [${mets.toFixed(2)}METs]` : '';

			await slack.chat.postMessage({
				as_user: true,
				channel: FITNESS_ID,
				unfurl_links: false,
				unfurl_media: false,
				text: stripIndent`
					:exercise-done: エアロバイク${exerciseMinutes}分 (:fire:${calories}kcal${metsString} :bicyclist:${distance}km :heartbeat:${averageHeartRate}bpm)
					${animeInfo}
				`,
			});

			await activityDoc.ref.set({isPosted: true}, {merge: true});
		}
	}
});
