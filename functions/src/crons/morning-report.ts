import {logger, pubsub} from 'firebase-functions';
import {SANDBOX_ID} from '../const.js';
import {webClient as slack} from '../slack.js';

export const sleepMorningReportCronJob = pubsub
	.schedule('30 7 * * *')
	.timeZone('Asia/Tokyo')
	.onRun(async () => {
		const {ts} = await slack.chat.postMessage({
			as_user: true,
			channel: SANDBOX_ID,
			text: 'あさ！',
			blocks: [
				{
					type: 'section',
					text: {
						type: 'plain_text',
						text: 'これすき',
						emoji: true,
					},
				},
			],
		});

		logger.log(`Posted morning report (ts = ${ts})`);

		await new Promise((resolve) => {
			setTimeout(resolve, 10000);
		});

		if (ts) {
			await slack.chat.delete({
				ts,
				channel: SANDBOX_ID,
			});

			logger.log(`Removed morning report (ts = ${ts})`);
		}
	});
