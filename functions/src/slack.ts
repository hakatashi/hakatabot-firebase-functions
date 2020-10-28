import {createEventAdapter} from '@slack/events-api';
import {WebClient} from '@slack/web-api';
import {https, logger, config as getConfig} from 'firebase-functions';
import {HAKATASHI_ID} from './const';
import twitter from './twitter';

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

const getTwitterAccount = (reaction: string) => {
	if (reaction === 'white_large_square' || reaction === 'red_large_square') {
		return 'hakatashi';
	}
	if (reaction === 'a') {
		return 'hakatashi_A';
	}
	if (reaction === 'b') {
		return 'hakatashi_B';
	}
	if (reaction === 'o2') {
		return 'hakatashi_O';
	}
	if (reaction === 'ab') {
		return 'hakatashi_AB';
	}
	return null;
};

eventAdapter.on('reaction_added', async (event: ReactionAddedEvent) => {
	if (event.user === HAKATASHI_ID && event.item_user === HAKATASHI_ID && event.item.type === 'message') {
		const account = getTwitterAccount(event.reaction);

		if (account === null) {
			return;
		}

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
		try {
			const data = await twitter(account, 'POST', 'statuses/update', {status: message.text});
			logger.info(`Tweeted ${JSON.stringify(message.text)} with tweet ID ${data.id_str}`);
		} catch (error) {
			logger.error('Tweet errored', error);
		}
	}
});

export const slackEvent = https.onRequest(eventAdapter.requestListener());
