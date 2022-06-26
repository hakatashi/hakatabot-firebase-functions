import axios from 'axios';
import {logger, pubsub} from 'firebase-functions';
import {EXPIRATION_WINDOW_IN_SECONDS, HAKATASHI_EMAIL} from '../const';
import {FitbitSleeps, FitbitTokens} from '../firestore';
import {client} from '../fitbit';

export const sleepGetCronJob = pubsub.schedule('every 5 minutes').onRun(async () => {
	const hakatashiTokensData = await FitbitTokens.doc(HAKATASHI_EMAIL).get();

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
		await FitbitTokens.doc(HAKATASHI_EMAIL).set(accessToken.token, {merge: true});
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
		await FitbitSleeps.doc(sleep.logId.toString()).set(sleep, {merge: true});
	}
});
