import {stripIndent} from 'common-tags';
import dayjs from 'dayjs';
import {logger, pubsub} from 'firebase-functions';
import {last} from 'lodash';
import {FITNESS_ID} from '../const';
import {AnimeWatchRecords, FitbitActivities} from '../firestore';
import * as fitbit from '../fitbit';
import {webClient as slack} from '../slack';

export const exerciseGetCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	logger.info('Getting fitbit activities...');
	const res = await fitbit.get('/1/user/-/activities/list.json', {
		afterDate: '1970-01-01',
		sort: 'desc',
		limit: 100,
		offset: 0,
	});

	logger.info(`Retrieved ${res.activities.length} activities`);
	for (const activity of res.activities) {
		await FitbitActivities.doc(activity.logId.toString()).set(activity, {merge: true});
	}
});

export const exercisePostCronJob = pubsub.schedule('every 1 minutes').onRun(async () => {
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
				// eslint-disable-next-line prefer-destructuring
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
			const weightsResponse = await fitbit.get(`/1/user/-/body/log/weight/date/${today}/1m.json`, {});
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
