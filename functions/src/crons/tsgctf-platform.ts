import axios from 'axios';
import {info as logInfo} from 'firebase-functions/logger';
import {onSchedule} from 'firebase-functions/v2/scheduler';

export const tsgctfPlatformConsolidateTasksCronJob = onSchedule('every 1 minutes', async () => {
	logInfo('tsgctfPlatformConsolidateTasksCronJob started');

	const res = await axios.post('https://tsgctf-platform.vercel.app/api/crons/consolidateTasks');

	logInfo(`tsgctfPlatformConsolidateTasksCronJob finished: ${res.status}`);
	logInfo(res.data);
});
