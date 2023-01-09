import axios from 'axios';
import {https, logger} from 'firebase-functions';
import {get, last} from 'lodash';
import {EXPIRATION_WINDOW_IN_SECONDS, HAKATASHI_EMAIL} from '../const';
import {FitbitTokens} from '../firestore';
import {client} from '../fitbit';

export const fitbitLatestHeartBeatRate = https.onRequest(async (request, response) => {
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

	logger.info('Getting fitbit heart rate history...');
	const res = await axios.get('https://api.fitbit.com/1/user/-/activities/heart/date/today/1d/5min.json', {
		headers: {
			Authorization: `Bearer ${accessToken.token.access_token}`,
		},
	});

	const history: {value: number}[] = get(res, ['data', 'activities-heart-intraday', 'dataset'], []);
	logger.info(`Retrieved ${history.length} datapoints of heart rate`);

	const latestHeartrate = last(history);
	if (!latestHeartrate) {
		response.json({
			schemaVersion: 1,
			label: 'Heart Beat',
			message: '-',
			color: 'orange',
		});
		return;
	}

	response.json({
		schemaVersion: 1,
		label: 'Heart Beat',
		message: `${latestHeartrate.value} bpm`,
		color: 'orange',
	});
});
