const axios = require('axios');
const FormData = require('form-data');
const qs = require('qs');
const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-2'});

const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

// ---------- Constants

const token = process.env.TOKEN;
const label = process.env.LABEL;
const channel_name = 'team-best-team-prs-hackathon';
const base_slack_url = 'https://slack.com/api';
const team_name = 'elio.tanke';
const table_name = 'github_pr_slack_message_mapping';

const emoji_approved = 'white_check_mark';
const emoji_comment = 'speech_balloon';
const emoji_merged = 'ship';

const github_slack_username_map = {
    'rosalynn-chong-clio': 'rosalynn.chong',
    'coryb2424': 'cory.bonneau',
    'JRSpencer': 'james.spencer',
    'rogerli2012': 'roger.li',
    'eliotanke': 'elio.tanke',
    'elio303': 'james.spencer',
};

// ---------- Simple helpers

const getCommentMessage = (url, requester, commenter) => {
    if (requester === commenter) return `:${emoji_comment}: ${commenter} <${url}|commented>`;
    return `@${requester} :${emoji_comment}: ${commenter} <${url}|commented>`;
}
const getCreateMessage = (url, title) => `@${team_name} CR please: <${url}|${title}>`;
const getApprovedMessage = (url, requester, approver) => `@${requester} :${emoji_approved}: ${approver} <${url}|approved>`;
const getMergedMessage = () => `:${emoji_merged}: Shipped!`;
const getSlackUsername = github_username => github_slack_username_map[github_username] || 'Unknown';
const getClioEmail = github_username => `${getSlackUsername(github_username)}@clio.com`;

// ---------- Axios wrappers to call the Slack API

const createForm = data => {
    const form = new FormData();
    Object.entries(data).forEach(([key, value]) => form.append(key, value));
    return form;
};

const getAuthHeaders = (slack_user_id) => ({
    "Authorization": `Bearer ${token}`,
    ...slack_user_id && { "X-Slack-User": slack_user_id },
});

const getOptions = (form, slack_user_id) => ({
    headers: {
        ...form.getHeaders(),
        ...getAuthHeaders(slack_user_id)
    }
});

const post = async (path, data, slack_user_id) => {
    const url = `${base_slack_url}/${path}`;
    const form = createForm(data);
    const options = getOptions(form, slack_user_id);
    return await axios.post(url, form, options);
};

// ---------- External calls to Slack API

const getChannelId = async () => {
    const { data } = await post('conversations.list', {});
    return data.channels.find(({ name }) => channel_name === name).id;
};

const getSlackUser = async (github_username) => {
    const email = getClioEmail(github_username);
    const { data } = await post('users.lookupByEmail', { email });
    return data.user;
};

const addReaction = async (channel, name, slack_user, timestamp) => {
    return await post(
        'reactions.add',
        { channel, name, timestamp },
        slack_user.id
    );
};

const postMessage = async (channel, text, slack_user, thread_ts) => {
    return await post('chat.postMessage',
        {
            channel,
            text,
            username: slack_user.real_name,
            icon_url: slack_user.profile?.image_48,
            ...thread_ts && { thread_ts },
            link_names: String(true),
            unfurl_links: String(!thread_ts)
        },
        slack_user.id
    );
};

// ---------- Calls to DynamoDB API

const savePullRequestMapping = async (github_url, slack_message_id) => {
    const params = {
        TableName: table_name,
        Item: {
            'GITHUB_URL': { S: String(github_url) },
            'SLACK_MESSAGE_ID': { S: String(slack_message_id) },
        },
    };
    return await ddb.putItem(params).promise();
};

const getSlackMessageId = async (github_url) => {
    const params = {
        TableName: table_name,
        Key: {
            'GITHUB_URL': { S: String(github_url) },
        },
        ProjectionExpression: 'SLACK_MESSAGE_ID'
    };
    const { Item } = await ddb.getItem(params).promise();
    return Item.SLACK_MESSAGE_ID.S;
};

// ---------- Event handlers

const handleCreate = async (pull_request) => {
    const pull_request_url = pull_request.html_url;
    const pull_request_title = pull_request.title;

    const github_requester_username = pull_request.user.login;

    const slack_channel_id = await getChannelId();
    const slack_message = getCreateMessage(pull_request_url, pull_request_title);
    const slack_user = await getSlackUser(github_requester_username);
    const slack_message_response = await postMessage(
        slack_channel_id,
        slack_message,
        slack_user
    );
    const slack_message_id = slack_message_response.data.ts;

    await savePullRequestMapping(pull_request_url, slack_message_id);
};

const handleReview = async (pull_request, review) => {
    const github_requester_username = pull_request.user.login;
    const github_reviewer_username = review.user.login;

    const requester = getSlackUsername(github_requester_username);
    const reviewer = getSlackUsername(github_reviewer_username);

    const approved_message = getApprovedMessage(
        review.html_url,
        requester,
        reviewer
    );
    const comment_message = getCommentMessage(
        review.html_url,
        requester,
        reviewer
    );

    const slack_channel_id = await getChannelId();
    const slack_message = review.state === 'approved' ? approved_message : comment_message;
    const slack_user = await getSlackUser(github_reviewer_username);
    const slack_message_id = await getSlackMessageId(pull_request.html_url);
    const slack_emoji = review.state === 'approved' ? emoji_approved : emoji_comment;

    await postMessage(slack_channel_id, slack_message, slack_user, slack_message_id);
    await addReaction(slack_channel_id, slack_emoji, slack_user, slack_message_id);
};

const handleClosed = async (pull_request) => {
    if (!pull_request.merged) return;

    const github_requester_username = pull_request.user.login;

    const slack_channel_id = await getChannelId();
    const slack_message = getMergedMessage();
    const slack_user = await getSlackUser(github_requester_username);
    const slack_message_id = await getSlackMessageId(pull_request.html_url);

    await postMessage(slack_channel_id, slack_message, slack_user, slack_message_id);
    await addReaction(slack_channel_id, emoji_merged, slack_user, slack_message_id);
};

// ---------- Event handling logic

exports.handler = async (event) => {
    console.log("event: " + JSON.stringify(event));

    const { action, pull_request, review } = event;
    const isValidLabel = pull_request.labels.some(({ name }) => name === label);

    if (label && !isValidLabel) return;

    switch (action) {
        case 'opened':
            await handleCreate(pull_request);
            break;
        case 'submitted':
            await handleReview(pull_request, review);
            break;
        case 'closed':
            await handleClosed(pull_request);
            break;
        default:
            console.log('We are ignoring this event');
    }
};

