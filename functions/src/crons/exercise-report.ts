import axios from 'axios';
import {stripIndent} from 'common-tags';
import {logger, pubsub} from 'firebase-functions';
import {EXPIRATION_WINDOW_IN_SECONDS, HAKATASHI_EMAIL} from '../const';
import {FitbitActivities, FitbitTokens} from '../firestore';
import {client} from '../fitbit';
import {webClient as slack} from '../slack';

export const exerciseGetCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	const hakatashiTokensData = await FitbitTokens.doc(HAKATASHI_EMAIL).get();

	if (!hakatashiTokensData.exists) {
		logger.error('hakatashi token not found');
		return;
	}

	const hakatashiTokens = hakatashiTokensData.data();
	let accessToken = client.createToken(hakatashiTokens as any);

	if (accessToken.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
		accessToken = await accessToken.refresh();
		await FitbitTokens.doc(HAKATASHI_EMAIL).set(accessToken.token, {merge: true});
	}

	logger.info('Getting fitbit activities...');
	const res = await axios.get('https://api.fitbit.com/1/user/-/activities/list.json', {
		params: {
			afterDate: '1970-01-01',
			sort: 'desc',
			limit: 100,
			offset: 0,
		},
		headers: {
			Authorization: `Bearer ${accessToken.token.access_token}`,
		},
	});

	logger.info(`Retrieved ${res.data.activities.length} activities`);
	for (const activity of res.data.activities) {
		await FitbitActivities.doc(activity.logId.toString()).set(activity, {merge: true});
	}
});

export const exercisePostCronJob = pubsub.schedule('every 1 minutes').onRun(async () => {
	const now = Date.now();
	const thresholdTime = now + 5 * 60 * 1000;

	const activitiesResults = await FitbitActivities.orderBy('startTime', 'desc').limit(100).get();
	for (const activityDoc of activitiesResults.docs) {
		if (activityDoc.get('isPosted')) {
			continue;
		}

		if (activityDoc.get('activityName') !== 'Treadmill') {
			continue;
		}

		const startTime = new Date(activityDoc.get('startTime')).getTime();
		const duration = activityDoc.get('duration');
		const endTime = startTime + duration;

		if (endTime < thresholdTime) {
			const exerciseMinutes = Math.floor(duration / 60 / 1000);
			const calories = activityDoc.get('calories');
			const distance = (calories * 15).toFixed(2);
			const averageHeartRate = activityDoc.get('averageHeartRate');

			await slack.chat.postMessage({
				username: 'hakatashi',
				icon_emoji: ':hakatashi:',
				text: stripIndent`
					:exercise-done: エアロバイク${exerciseMinutes}分 (:fire:${calories}kcal :bicyclist:${distance}km :heartbeat:${averageHeartRate}bpm)
					(+ラブライブ！虹ヶ咲学園スクールアイドル同好会TVアニメ2期 <https://animestore.docomo.ne.jp/animestore/ci_pc?workId=25330&partId=25330002|第2話「重なる色」>)
				`,
				channel: 'DEHM87DM2',
			});

			await activityDoc.ref.set({isPosted: true}, {merge: true});
		}
	}
});
