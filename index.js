const axios = require('axios');
const FormData = require('form-data');
const qs = require('qs');
const AWS = require('aws-sdk');

AWS.config.update({region: 'us-east-2'});

const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

// ---------- Constants

const token = 'xoxp-2068572193780-2059334412149-2065106501474-9c906d3a96e08f01f204b0be3949fbc3';
const channel_name = 'team-best-team-prs-hackathon';
const base_slack_url = 'https://slack.com/api';
const team_name = 'elio.tanke';
const table_name = 'github_pr_slack_message_mapping';

const emoji_approved = 'white_check_mark';
const emoji_comment = 'speech_balloon';

const github_slack_username_map = {
    'rosalynn-chong-clio': 'rosalynn.chong',
    'coryb2424': 'cory.bonneau',
    'JRSpencer': 'james.spencer',
    'rogerli2012': 'roger.li',
    'eliotanke': 'elio.tanke',
    'elio303': 'james.spencer',
};

// ---------- Simple helpers

const getCreateMessage = (url, title) => `@${team_name} CR please: <${url}|${title}>`;
const getCommentMessage = (url, requester, commenter) => `Hey @${requester}! ${commenter} <${url}|commented> on your pull request`;
const getSlackUsername = github_username => github_slack_username_map[github_username] || 'Unknown';
const getClioEmail = github_username => `${getSlackUsername(github_username)}@clio.com`;

// ---------- Axios wrappers to call the Slack API

const createForm = data => {
    const form = new FormData();
    Object.entries(data).forEach(([key, value]) => form.append(key, value));
    return form;
};

const get = async (path, data) => await axios.post(`${base_slack_url}/${path}`, qs.stringify(data));

const post = async (path, data) => {
    const url = `${base_slack_url}/${path}`;
    const form = createForm(data);

    return await axios.post(url, form, { headers: form.getHeaders() });
};

// ---------- External calls to Slack API

const getChannelId = async () => {
    const { data } = await get('conversations.list', { token });
    return data.channels.find(({ name }) => channel_name === name).id;
};

const getSlackUserId = async (github_username) => {
    const email = getClioEmail((github_username));
    const { data } = await post('users.lookupByEmail', { token, email });
    return data.user.id;
};

const addReaction = async (channel, name, timestamp) => {
    return await post('reactions.add',
        { token, channel, name, timestamp }
    );
};

const postMessage = async (channel, text, username, thread_ts) => {
    return await post('chat.postMessage',
        {
            token,
            channel,
            text,
            username,
            ...thread_ts && { thread_ts },
            link_names: String(1),
            unfurl_links: String(!thread_ts)
        }
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

// ---------- Event handling logic

exports.handler = async (event) => {
    console.log("event: " + JSON.stringify(event));

    const { action, pull_request, comment, review } = event;
    const channel_id = await getChannelId();

    let slack_message_id;

    switch (action) {
        case 'opened':
            const pull_request_url = pull_request.html_url;
            const pull_request_title = pull_request.title;

            const github_requester_username = pull_request.user.login;

            const message = getCreateMessage(pull_request_url, pull_request_title);

            const slack_user_id = await getSlackUserId(github_requester_username);
            const slack_message_response = await postMessage(channel_id, message, slack_user_id);

            slack_message_id = slack_message_response.data.ts;

            await savePullRequestMapping(pull_request_url, slack_message_id);
            break;
        case 'submitted':
            if (review) {
                slack_message_id = await getSlackMessageId(pull_request.html_url);

                switch (review.state) {
                    case 'approved':
                        await addReaction(channel_id, emoji_approved, slack_message_id);
                        break;
                    case 'commented':
                    case 'changes_requested':
                        const github_requester_username = pull_request.user.login;
                        const github_reviewer_username = review.user.login;

                        const requester = getSlackUsername(github_requester_username);
                        const reviewer = getSlackUsername(github_reviewer_username);

                        const message = getCommentMessage(review.html_url, requester, reviewer);
                        const slack_user_id = await getSlackUserId(github_reviewer_username);

                        await postMessage(channel_id, message, slack_user_id, slack_message_id);
                        await addReaction(channel_id, emoji_comment, slack_message_id);
                        break;
                    default:
                        console.log('Pull request review did not match any predefined states');
                        return;
                }
                break;
            }
        case 'closed':
            // Add :merged: emoji to post in Slack
            break;
        default:
            console.log('We are ignoring this event');
    }
};

