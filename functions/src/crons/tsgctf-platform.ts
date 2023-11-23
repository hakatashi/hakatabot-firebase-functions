import axios from 'axios';
import {logger, pubsub} from 'firebase-functions';

export const tsgctfPlatformConsolidateTasksCronJob = pubsub.schedule('every 1 minutes').onRun(async () => {
	logger.info('tsgctfPlatformConsolidateTasksCronJob started');

	const res = await axios.post('https://tsgctf-platform.vercel.app/api/crons/consolidateTasks');

	logger.info(`tsgctfPlatformConsolidateTasksCronJob finished: ${res.status}`);
	logger.info(res.data);

	return null;
});
