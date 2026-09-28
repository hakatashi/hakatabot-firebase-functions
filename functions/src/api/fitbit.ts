import {info as logInfo} from 'firebase-functions/logger';
import {onRequest} from 'firebase-functions/v2/https';
import get from 'lodash/get.js';
import last from 'lodash/last.js';
import {get as fitbitGet} from '../fitbit.js';

export const fitbitLatestHeartBeatRate = onRequest({memory: '512MiB'}, async (request, response) => {
	logInfo('Getting fitbit heart rate history...');
	const res = await fitbitGet('/1/user/-/activities/heart/date/today/1d/5min.json', {});

	const history: {value: number}[] = get(res, ['activities-heart-intraday', 'dataset'], []);
	logInfo(`Retrieved ${history.length} datapoints of heart rate`);

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
