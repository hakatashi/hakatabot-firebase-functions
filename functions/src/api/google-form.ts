import {PubSub} from '@google-cloud/pubsub';
import {config as getConfig} from 'firebase-functions';
import {info as logInfo, error as logError} from 'firebase-functions/logger';
import {onRequest} from 'firebase-functions/v2/https';

const config = getConfig();

export const googleFormLlmBenchmarkSubmission = onRequest(async (request, response) => {
	logInfo('googleFormLlmBenchmarkSubmission started');
	logInfo(`method: ${request.method}`);

	if (request.method !== 'POST') {
		response.status(405);
		response.send('Method Not Allowed');
		return;
	}

	const data = request.body;

	if (data.token !== config.api.token) {
		logError('Invalid token');
		response.status(403);
		response.send('Forbidden');
		return;
	}

	const pubsubClient = new PubSub();

	await pubsubClient.topic('hakatabot').publishMessage({
		data: Buffer.from(JSON.stringify({
			type: 'llm-benchmark-submission',
			data,
		})),
	});

	logInfo('Published LLM benchmark submission message to topic hakatabot');

	response.status(200).send('OK');
});
