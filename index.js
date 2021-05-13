const { WebClient, LogLevel } = require("@slack/web-api");

const client = new WebClient("xoxb-your-token", {
  logLevel: LogLevel.DEBUG
});

async function findConversation(name) {
  try {
    const { channels } = await client.conversations.list({
      token: "xoxb-your-token"
    });
    
    const { id } = channels.find(channel => channel.name === name);
    
    return id;
  } catch (error) {
    console.error(error);
  }
}

async function publishMessage(id, text, username, icon_url) {
  try {
    const result = await client.chat.postMessage({
      token: "xoxb-your-token",
      channel: id,
      text,
      username,
      icon_url
    });
    console.log(result);
  } catch (error) {
    console.error(error);
  }
}

const usernameMap = {
    'rosalynn-chong-clio': 'rosalynn.chong',
    'coryb2424': 'cory.bonneau',
    'JRSpencer': 'james.spencer',
    'rogerli2012': 'roger.li',
    'eliotanke': 'elio.tanke',
};

exports.handler = async (event) => {
    // Log the request
    console.log("event: " + JSON.stringify(event));
    
    const { pull_request, action } = event;
    const { html_url, title, user } = pull_request;
    const { login, avatar_url } = user;
    const slack_user = usernameMap[login];
    
    console.log("github username: " + login);
    console.log("github action: " + action);
    
    console.log("pull request title: " + title);
    console.log("pull request url: " + html_url);
    
    console.log("slack username: " + slack_user);
    
    findConversation('team-best-team-prs-hackathon').then(id => {
        switch(action) {
            case 'opened':
                const pr_link = `[${title}](${html_url})`;
                publishMessage(
                    id, 
                    `@payments-devs CR please: ${pr_link}`,
                    slack_user,
                    avatar_url
                );
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
    });
};

