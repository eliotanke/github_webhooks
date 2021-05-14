# github_webhooks

## Disclaimer

Please DO NOT upload the Slack API token to this repository. The moment you do this, Slack will revoke access to that API token and you will need to create a new API token.

## AWS Console

1. Log into Sandbox_Clio_Developer via Okta
2. See DynamoDB, Lambda and API Gateway for details

## API Gateway

API Gateway is used as a webhook entry point so Github call call it and implicitly invoke our lambda function. For more details, see the [API Gateway in the AWS Console](https://us-east-2.console.aws.amazon.com/apigateway/home?region=us-east-2#/apis/z5p2zl1bwl/resources/zpr0q57ptd/methods/POST).

## Lambda

We use lambda to process webhook events from Github. Lambda will post data to Slack after processing

1. To deploy your lambda function, please run the `zip.sh` file locally. It will create a file called `github_webhook_handler.zip` in the directory one level above.
2. Upload `github_webhook_handler.zip` to the [lambda function console](https://us-east-2.console.aws.amazon.com/lambda/home?region=us-east-2#/functions/process_github_webhooks) by clicking on the `Upload from` dropdown at the right side of the page.
3. Trigger the function either by creating a pull request, or by clicking `test` on the [lambda function console](https://us-east-2.console.aws.amazon.com/lambda/home?region=us-east-2#/functions/process_github_webhooks). Note that this only triggers the `opened` event

## Dynamo DB

Dynamo DB stores a mapping between pull request URLs and their corresponding post in Slack. This will be used to comment and add emojis to existing posts in Slack. For more information, see the [Dynamo DB table in the AWS Console](https://us-east-2.console.aws.amazon.com/dynamodb/home?region=us-east-2#tables:selected=github_pr_slack_message_mapping;tab=items). 
