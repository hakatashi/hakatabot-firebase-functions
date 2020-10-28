import qs from 'querystring';
import {config as getConfig} from 'firebase-functions';
import {OAuth} from 'oauth';

const config = getConfig();

export default (account: string, method: 'GET' | 'POST', endpoint: string, parameters: {[key: string]: string}) => {
	const keys = config.twitter.tokens[account.toLowerCase()];
	if (typeof keys !== 'object') {
		throw new Error(`token not found: ${account}`);
	}

	const oauth = new OAuth(
		'https://api.twitter.com/oauth/request_token',
		'https://api.twitter.com/oauth/access_token',
		keys.consumer_key,
		keys.consumer_secret,
		'1.0A',
		null,
		'HMAC-SHA1',
	);

	const domain = `${endpoint.startsWith('media/') ? 'upload' : 'api'}.twitter.com`;

	return new Promise<any>((resolve, reject) => {
		if (method === 'GET') {
			oauth.get(
				`https://${domain}/1.1/${endpoint}.json?${qs.stringify(parameters)}`,
				keys.access_token,
				keys.access_token_secret,
				(error, d) => {
					if (error) {
						reject(error);
					} else if (d) {
						resolve(JSON.parse(d.toString()));
					} else {
						reject(new Error('No data'));
					}
				},
			);
		} else {
			oauth.post(
				`https://${domain}.twitter.com/1.1/${endpoint}.json`,
				keys.access_token,
				keys.access_token_secret,
				parameters,
				'application/x-www-form-urlencoded',
				(error, d) => {
					if (error) {
						reject(error);
					} else if (d) {
						resolve(JSON.parse(d.toString()));
					} else {
						reject(new Error('No data'));
					}
				},
			);
		}
	});
};
