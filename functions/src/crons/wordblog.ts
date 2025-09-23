import {Octokit} from '@octokit/rest';
import axios from 'axios';
import {info as logInfo, error as logError} from 'firebase-functions/logger';
import {defineString} from 'firebase-functions/params';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import type {ScheduledEvent} from 'firebase-functions/v2/scheduler';
import {postBluesky, postMastodon, postThreads} from './lib/social.js';

const GITHUB_TOKEN = defineString('GITHUB_TOKEN');
const SCRAPBOX_SID = defineString('SCRAPBOX_SID');

interface ScrapboxUser {
	id: string,
	name: string,
	displayName: string,
	photo: string, // URL
}

interface ScrapboxLine {
	id: string,
	text: string,
	userId: string,
	created: number,
	updated: number,
}

interface ScrapboxPage {
	id: string,
	title: string,
	image: string, // URL
	descriptions: string[],
	user: ScrapboxUser,
	pin: number,
	views: number,
	linked: number,
	commitId: string,
	created: number,
	updated: number,
	accessed: number,
	snapshotCreated: number,
	persistent: boolean,
	lines: ScrapboxLine[],
}

interface Entry {
	word: string,
	ruby: string,
	descriptions: string[],
	cite: string,
}

const github = new Octokit({
	auth: GITHUB_TOKEN.value(),
});

const getCite = (cite: string, word: string) => {
	if (cite === 'goo') {
		return `<cite>[デジタル大辞泉「${word}」](https://dictionary.goo.ne.jp/word/${encodeURIComponent(word)}/)</cite>より引用`;
	}
	if (cite === 'kojien') {
		return `<cite>広辞苑「${word}」</cite>より引用`;
	}
	if (cite === 'kotobank') {
		return `<cite>[コトバンク「${word}」](https://kotobank.jp/word/${encodeURIComponent(word)})</cite>より引用`;
	}
	if (cite === 'wikipedia') {
		return `<cite>[${word} - Wikipedia](https://ja.wikipedia.org/wiki/${encodeURIComponent(word)})</cite>より引用`;
	}
	return '';
};

const updateWordBlogFunction = async (context: ScheduledEvent) => {
	const date = new Intl.DateTimeFormat('eo', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date(context.scheduleTime));

	logInfo('Retrieving Scrapbox data...');

	const scrapboxUrl = `https://scrapbox.io/api/pages/hakatashi/${encodeURIComponent('日本語')}`;
	const {data} = await axios.get<ScrapboxPage>(scrapboxUrl, {
		headers: {Cookie: `connect.sid=${SCRAPBOX_SID.value()}`},
	});
	logInfo(`Retrieved ${data.lines.length} lines from Scrapbox`);

	const entries: Entry[] = [];

	{
		let word = '';
		let ruby = '';
		let descriptions: string[] = [];
		let cite = '';
		for (const line of data.lines) {
			const indents = line.text.match(/^[ \t]*/)![0] || '';
			const indentLevel = indents.length;
			const text = line.text.trim();

			if (indentLevel === 0) {
				continue;
			}

			if (indentLevel === 1) {
				if (word !== '') {
					entries.push({word, ruby, descriptions, cite});
					ruby = '';
					descriptions = [];
					cite = '';
				}

				const tokens = text.split(/[()（）)]/);
				word = tokens[0].trim();
				if (tokens.length >= 2) {
					ruby = tokens[1].trim();
				}
				continue;
			}

			const tokens = text.split(': ');
			if (tokens[0] === 'cite' && tokens[1]) {
				cite = tokens[1].trim();
				continue;
			}

			descriptions.push('    '.repeat(indentLevel - 2) + text);
		}

		if (word !== '') {
			entries.push({word, ruby, descriptions, cite});
		}
	}

	entries.reverse();

	logInfo(`Retrieved ${entries.length} entries from Scrapbox`);

	const owner = 'hakatashi';
	const repo = 'word.hakatashi.com';

	logInfo('Getting default branch...');
	const {data: repoInfo} = await github.repos.get({owner, repo});
	const defaultBranch = repoInfo.default_branch;

	logInfo('Getting files under _posts directory...');
	const {data: files} = await github.repos.getContent({
		owner,
		repo,
		path: 'source/_posts',
		ref: defaultBranch,
	});

	const postedEntries = new Set<string>();

	if (Array.isArray(files)) {
		for (const file of files) {
			postedEntries.add(file.name.replace(/\.md$/, ''));
		}
	}

	logInfo(`Retrieved ${postedEntries.size} posted entries`);

	const entry = entries.find(({word}) => !postedEntries.has(word));
	if (entry === undefined) {
		logInfo('Couldn\'t find entry to post. Exiting...');
		return;
	}

	logInfo(`Posting entry ${JSON.stringify(entry, null, '  ')}`);

	const lines = [
		'---',
		`title: ${entry.word}`,
		`subtitle: ${entry.ruby}`,
		`date: ${date} 10:00:00`,
		'---',
		'',
		...entry.descriptions,
		'',
		getCite(entry.cite, entry.word),
	];

	logInfo(`File to post: ${JSON.stringify(lines)}`);

	logInfo('Getting commit hash...');
	const {data: ref} = await github.git.getRef({owner, repo, ref: `heads/${defaultBranch}`});
	const commitHash = ref.object.sha;

	logInfo('Getting tree hash...');
	const {data: commit} = await github.repos.getCommit({owner, repo, ref: commitHash});

	logInfo('Creating new tree...');
	const {data: tree} = await github.git.createTree({
		owner,
		repo,
		base_tree: commit.commit.tree.sha,
		tree: [
			{
				path: `source/_posts/${entry.word}.md`,
				mode: '100644',
				type: 'blob',
				content: lines.join('\n'),
			},
		],
	});

	logInfo('Creating new commit...');
	const {data: newCommit} = await github.git.createCommit({
		owner,
		repo,
		message: `BOT: Add source/_posts/${entry.word}.md`,
		author: {
			name: 'Koki Takahashi',
			email: 'hakatasiloving@gmail.com',
			date: new Date(context.scheduleTime).toISOString(),
		},
		parents: [ref.object.sha],
		tree: tree.sha,
	});

	logInfo('Updating ref...');
	const {data: newRef} = await github.git.updateRef({
		owner,
		repo,
		sha: newCommit.sha,
		force: false,
		ref: `heads/${defaultBranch}`,
	});

	logInfo(`done. (commit = ${newRef.object.sha})`);

	logInfo(`done. (commit = ${newRef.object.sha})`);

	logInfo('Waiting for 60 seconds...');

	await new Promise((resolve) => {
		setTimeout(resolve, 60 * 1000);
	});

	const url = `https://word.hakatashi.com/${date.replace(/-/g, '')}/`;

	logInfo('Posting to Mastodon...');
	try {
		const res = await postMastodon(`hakatashiの一日一語: 「${entry.word}」 ${url}`);
		logInfo(`done. (id_str = ${res.id})`);
	} catch (error) {
		logError(`Failed to post to Mastodon: ${error}`);
	}

	logInfo('Posting to Bluesky...');
	try {
		const res = await postBluesky(`hakatashiの一日一語: 「${entry.word}」 ${url}`);
		logInfo(`done. (id = ${res.id})`);
	} catch (error) {
		logError(`Failed to post to Bluesky: ${error}`);
	}

	logInfo('Posting to Threads...');
	try {
		const res = await postThreads(`hakatashiの一日一語: 「${entry.word}」 ${url}`);
		logInfo(`done. (id = ${res.id})`);
	} catch (error) {
		logError(`Failed to post to Threads: ${error}`);
	}

	logInfo('done.');
};

export const updateWordBlog = onSchedule(
	{
		timeoutSeconds: 120,
		schedule: '0 10 * * *',
		timeZone: 'Asia/Tokyo',
		memory: '512MiB',
	},
	updateWordBlogFunction,
);
