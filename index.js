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

const github_slack_username_map = {
    'rosalynn-chong-clio': 'rosalynn.chong',
    'coryb2424': 'cory.bonneau',
    'JRSpencer': 'james.spencer',
    'rogerli2012': 'roger.li',
    'eliotanke': 'elio.tanke',
};

// ---------- Simple helpers

const getCreateMessage = (url, title) => `@${team_name} CR please: <${url}|${title}>`;
const getCommentMessage = (url, requestor, commenter) => `Hey @${requestor}! ${commenter} <${url}|commented> on your pull request`;
const getSlackUsername = github_username => github_slack_username_map[github_username] || 'Unknown';
const getClioEmail = github_username => `${getSlackUsername(github_username)}@clio.com`;

// ---------- Axios wrappers to call the Slack API

const get = async (url, data) => await axios.post(url, qs.stringify(data));

const post = async (url, data) => {
    const form = new FormData();
    Object.entries(data).forEach(([key, value]) => {
        form.append(key, value);
    });
    return await axios.post(
        url,
        form,
        { headers: form.getHeaders() }
    );
};

// ---------- External calls to Slack API

const getChannelId = async () => {
    const { data } = await get(`${base_slack_url}/conversations.list`, { token });
    return data.channels.find(({ name }) => channel_name === name).id;
};

const getSlackUserId = async (github_username) => {
    const email = getClioEmail((github_username));
    return await post(`${base_slack_url}/users.lookupByEmail`, { token, email }).data.user.id;
};

const postMessage = async (channel, text, username, thread_ts) => {
    return await post(`${base_slack_url}/chat.postMessage`,
        {
            token,
            channel,
            text,
            username,
            ...thread_ts && { thread_ts },
            link_names: 1,
        }
    );
};

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

    switch (action) {
        case 'opened':
            if (pull_request) {
                const message = getCreateMessage(pull_request.html_url, pull_request.title);
                const slack_user_id = await getSlackUserId(pull_request.user.login);

                const post_message_response = await postMessage(
                    channel_id,
                    message,
                    slack_user_id
                );
                await savePullRequestMapping(html_url, post_message_response.data.ts);
                break;
            }
        case 'submitted':
            if (review) {
                console.log("REVIEWED");
                break;
            }
        case 'created':
            if (comment) {
                // Add :comment: emoji to post in Slack
                const github_requestor_username = pull_request.user.login;
                const github_commenter_username = comment.user.login;

                const requestor = getSlackUsername(github_requestor_username);
                const commenter = getSlackUsername(github_commenter_username);

                const message = getCommentMessage(comment.html_url, requestor, commenter);
                const slack_user_id = await getSlackUserId(github_commenter_username);
                const slack_message_id = await getSlackMessageId(pull_request.html_url);

                await postMessage(
                    channel_id,
                    message,
                    slack_user_id,
                    slack_message_id
                );
                break;
            }
        case 'approved':
            // Add comment 'Approved by @slackUsername' to post in Slack
            // Add :check: emoji to post in Slack
            break;
        case 'closed':
            // Add :merged: emoji to post in Slack
            break;
        default:
            console.log('We are ignoring this event');
    }
};

