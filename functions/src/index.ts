/* eslint-disable import/prefer-default-export */

import {https, logger} from 'firebase-functions';
import {google} from 'googleapis';

export * from './slack';

const fitness = google.fitness('v1');

export const helloWorld = https.onRequest(async (request, response) => {
	const dataSources = await fitness.users.dataSources.list({userId: 'me'});
	logger.info(dataSources, {structuredData: true});
	response.send(JSON.stringify(dataSources, null, '  '));
});
