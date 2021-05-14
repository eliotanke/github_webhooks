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

const username_email_map = {
    'rosalynn-chong-clio': 'rosalynn.chong@clio.com',
    'coryb2424': 'cory.bonneau@clio.com',
    'JRSpencer': 'james.spencer@clio.com',
    'rogerli2012': 'roger.li@clio.com',
    'eliotanke': 'elio.tanke@clio.com',
};

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

const getChannelId = async (channel_name) => {
    const { data } = await get(
        "https://slack.com/api/conversations.list",
        { token }
    );
    return data.channels.find(({ name }) => channel_name === name).id;
};

const getSlackUserId = async (github_login) => {
    const email = username_email_map[github_login];
    const { data } = await post(`${base_slack_url}/users.lookupByEmail`,
    {
            token,
            email,
        }
    );
    return data.user.id;
};

const postMessage = async (channel, text, username, link_names = 1) => {
    await post(`${base_slack_url}/chat.postMessage`,
    {
            token,
            channel,
            text,
            username,
            link_names,
        }
    );
};

const savePullRequestMapping = (github_url, slack_message_id) => {
    const params = {
        'TableName': table_name,
        'Item': {
            'GITHUB_URL': github_url,
            'SLACK_MESSAGE_ID': slack_message_id,
        },
    };
    ddb.putItems(params, (error, data) => {
        if (error) console.log("DDB Error", error);
    });
};

// ---------- Simple helpers

const getMessage = (url, title) => `@${team_name} CR please: <${url}|${title}>`;

// ---------- Event handling logic

exports.handler = async (event) => {
    console.log("event: " + JSON.stringify(event));
    
    const { pull_request, action } = event;
    const { html_url, title, user } = pull_request;
    const { login } = user;

    const channel_id = await getChannelId(channel_name);
    const slack_user_id = await getSlackUserId(login);

    switch (action) {
        case 'opened':
        case 'reopened':
            const post_message_response = await postMessage(
                channel_id,
                getMessage(html_url, title),
                slack_user_id
            );
            // savePullRequestMapping(html_url, post_message_response.data.ts);
            break;
        case 'commented':
            // Add comment to post in Slack
            // Add :comment: emoji to post in Slack
            break;
        case 'approved':
            // Add comment 'Approved by @slackUsername' to post in Slack
            // Add :check: emoji to post in Slack
            break;
        case 'closed':
            // Add :merged: emoji to post in Slack
            break;
        default:
            console.log("We are ignoring this event");
    }
};

