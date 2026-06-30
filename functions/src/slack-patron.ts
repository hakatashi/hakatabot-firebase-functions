import axios from 'axios';
import {defineString} from 'firebase-functions/params';
import type {Message} from './slack.js';

// slack-patron (https://github.com/tsg-ut/slack-patron) is a caching proxy in
// front of the Slack Web API. conversations.replies has a tight rate limit on
// the raw Slack API, so thread lookups go through this proxy instead.
const SLACK_PATRON_BASE_URL = defineString('SLACK_PATRON_BASE_URL');
const SLACK_PATRON_API_TOKEN = defineString('SLACK_PATRON_API_TOKEN');

interface ConversationsRepliesResult {
	ok: boolean,
	messages?: Message[],
}

// Fetches the thread that the message identified by (channel, ts) belongs to.
// ts may be either the thread's parent ts or a reply's ts; Slack resolves
// either to the full thread. For a message with no thread, this returns an
// array containing just that single message.
export const getThreadMessages = async (channel: string, ts: string): Promise<Message[]> => {
	const res = await axios.post<ConversationsRepliesResult>(
		`${SLACK_PATRON_BASE_URL.value()}/api/conversations.replies`,
		new URLSearchParams({channel, ts, limit: '200'}).toString(),
		{
			headers: {
				Authorization: `Bearer ${SLACK_PATRON_API_TOKEN.value()}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
		},
	);

	return res.data.messages ?? [];
};
