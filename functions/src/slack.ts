import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import {https, logger, config as getConfig} from 'firebase-functions';
import {HAKATASHI_ID} from './const';

interface ReactionAddedEvent {
	type: 'reaction_added',
	user: string,
	item: {
		type: string,
		channel: string,
		ts: string,
	},
	reaction: string,
	item_user: string,
	event_ts: string,
}

interface Message {
	type: string,
	subtype: string,
	text: string,
	ts: string,
	username: string,
}

const config = getConfig();

const slack = new WebClient(config.slack.token);
const eventAdapter = createEventAdapter(config.slack.signing_secret);

eventAdapter.on('message', (event) => {
	logger.info(event);
});

eventAdapter.on('reaction_added', async (event: ReactionAddedEvent) => {
	logger.info(event);
	if (event.user === HAKATASHI_ID && event.item_user === HAKATASHI_ID && event.item.type === 'message') {
		const {messages}: {messages: Message[]} = await slack.conversations.replies({
			channel: event.item.channel,
			ts: event.item.ts,
			latest: event.item.ts,
			inclusive: true,
			limit: 1,
		}) as any;

		if (!messages || messages.length !== 1) {
			return;
		}

		const message = messages[0]!;
		logger.info(message.text);
	}
});

export const slackEvent = https.onRequest(eventAdapter.requestListener());
