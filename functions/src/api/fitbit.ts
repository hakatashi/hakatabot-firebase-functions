import {https, logger} from 'firebase-functions';
import get from 'lodash/get.js';
import last from 'lodash/last.js';
import * as fitbit from '../fitbit.js';

export const fitbitLatestHeartBeatRate = https.onRequest(async (request, response) => {
	logger.info('Getting fitbit heart rate history...');
	const res = await fitbit.get('/1/user/-/activities/heart/date/today/1d/5min.json', {});

	const history: {value: number}[] = get(res, ['activities-heart-intraday', 'dataset'], []);
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
