import {config as getConfig} from 'firebase-functions';
import {AuthorizationCode} from 'simple-oauth2';

const config = getConfig();


export const client = new AuthorizationCode({
	client: {
		id: config.fitbit.client_id,
		secret: config.fitbit.client_secret,
	},
	auth: {
		tokenHost: 'https://api.fitbit.com',
		tokenPath: '/oauth2/token',
		authorizeHost: 'https://www.fitbit.com',
		authorizePath: '/oauth2/authorize',
	},
});
