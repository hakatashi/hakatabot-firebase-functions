/* eslint-disable import/prefer-default-export */

import {createEventAdapter} from '@slack/events-api';
import {https, logger, config} from 'firebase-functions';

const eventAdapter = createEventAdapter(config().slack.signing_secret);

eventAdapter.on('message', (event) => {
	logger.info(event, {structuredData: true});
});

eventAdapter.on('reaction_added', (event) => {
	logger.info(event, {structuredData: true});
});

export const slackEvent = https.onRequest(eventAdapter.requestListener());
