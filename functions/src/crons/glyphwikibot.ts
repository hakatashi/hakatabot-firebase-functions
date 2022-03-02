import axios from 'axios';
import * as cheerio from 'cheerio';
import download from 'download';
import {logger, pubsub} from 'firebase-functions';
import twitter from '../twitter';

const randomGlyphURL = 'https://glyphwiki.org/wiki/Special:Random';
const glyphImageURL = 'https://glyphwiki.org/glyph/';

const getRandomGlyphUrl = async () => {
	const {status, headers} = await axios.get(randomGlyphURL, {
		maxRedirects: 0,
		validateStatus: null,
	});

	if (status !== 302) {
		throw new Error('Status not OK');
	}

	const url = new URL(headers.location, randomGlyphURL).href;
	if (!url) {
		throw new Error('Glyph URL not found');
	}

	const idMatch = url.match(/^https:\/\/glyphwiki\.org\/wiki\/(?<id>.+)$/);
	if (!idMatch) {
		throw new Error('Glyph ID not found');
	}

	const id = idMatch.groups?.id;
	return {url, id};
};

export const glyphwikibotCronJob = pubsub.schedule('*/30 * * * *').timeZone('Asia/Tokyo').onRun(async () => {
	const {url: glyphUrl, id: glyphId} = await getRandomGlyphUrl();
	const {status, data} = await axios.get(glyphUrl);

	// Extract glyph information
	if (status !== 200) {
		throw new Error('Status not OK');
	}

	const $ = cheerio.load(data);
	const metaName = $('h1 span').first().text();
	if (!metaName) {
		throw new Error('Meta name not found');
	}

	// Pipe out image request to twitter upload
	const imageUrl = `${glyphImageURL + glyphId}.png`;
	const imageData = await download(imageUrl);

	const uploadResult = await twitter('glyphwikibot', 'POST', 'media/upload', {
		media_data: imageData.toString('base64'),
		media_category: 'tweet_image',
	});

	if (!uploadResult.media_id_string) {
		throw new Error('Media upload error');
	}

	// Fetch image and post tweet
	const postResult = await twitter('glyphwikibot', 'POST', 'statuses/update', {
		status: `${glyphId} ${metaName} ${glyphUrl}`,
		media_ids: uploadResult.media_id_string,
	});

	logger.info(`Tweeted glyphwiki post with tweet ID ${postResult.id_str}`);
});

