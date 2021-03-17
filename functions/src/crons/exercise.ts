import {logger, pubsub, config as getConfig} from 'firebase-functions';
import {webClient as slack} from '../slack';
import type {GetMessagesResult} from '../slack';

const config = getConfig();

export const exerciseAlertCronJob = pubsub.schedule('every 30 minutes').onRun(async (context) => {
	const now = new Date(context.timestamp).getTime();

	const rangeStart = now - 3 * 24 * 60 * 60 * 1000;
	let cursor: string | null = null;
	const messages = [];

	while (true) {
		await new Promise((resolve) => {
			setTimeout(resolve, 1000);
		});

		const data = await slack.conversations.history({
			channel: config.slack.channels.exercise,
			inclusive: true,
			oldest: (rangeStart / 1000).toString(),
			limit: 100,
			...(cursor === null ? {} : {cursor}),
		}) as GetMessagesResult;

		logger.info(`Retrieved ${data.messages.length} rows (cursor = ${cursor})`);

		if (data.messages.length === 0) {
			break;
		}

		messages.push(...data.messages);

		if (data.has_more === false) {
			break;
		}

		cursor = data?.response_metadata?.next_cursor || null;
	}

	let didExercise = false;
	for (const message of messages) {
		if (message.user === config.slack.users.hakatashi && message.text.includes(':exercise-done:')) {
			didExercise = true;
			break;
		}

		if (message.username === 'はかたしをしかるひと') {
			didExercise = true;
			break;
		}
	}

	if (!didExercise) {
		const message = await slack.chat.postMessage({
			channel: config.slack.channels.exercise,
			text: `<@${config.slack.users.hakatashi}> もうまる3日間も運動してないよ！ このすかぽんちん！`,
			username: 'はかたしをしかるひと',
			icon_emoji: ':rage:',
		});
		logger.info(`Posted exercise alert message with ts = ${message.ts}`);
	}
});
