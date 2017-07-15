# Jitploy

Deploy and roll back without waiting forever

This repo includes a server and client that helps manage deployments through Github pushes and pull request merges.

In its current state, provides the following features
* Trigger deploys from pushes to github
* verify github post integrity
* deploy steps - git pull && decryptConfig() && npm install && npm run start
* Encrypts and decrypts configuration so that configuration can be part of versioning

The problem with high friction long cycle deployments is that they represent a serious risk to service agreements if they go wrong. The idea with immediate deployment is to reduce the complexity and risk of changing configuration and upgrading services. You should only need to revert to the head of the last release in order to rollback to a previous working state should something go wrong and it should take less than a minute. Which takes out a step of manually declaring a rollback in a configuration management solution. Another benefit to a shorter cycle time to release and rollback is that changes isolated to a narrower range of test scenarios. The developer has the opportunity to retain complete focus of failure and deployment considerations. Deployment steps are also automated away from the developer as well

Given speed is important there is no consideration of integration in this deployment system. Thats a feature, not a bug. If you want to test have the self discipline to run it locally. Add integration as a git hook if you have to, but keep in mind that it can get in the way of fixing something quickly. Albeit --no-verify could move things along in a pinch. Point is this service is designed with self discipline held in a higher regard than self policing.

# Run configuration considerations

This repo is set up to be run with heroku but it could be propped up on any public server with the following

### configuration

    GITHUB_SECRET = // secret shared with github webhook server
    TOKENS =        // comma space delimitated list of tokens for services to connect with
    TRUSTED_NAMES = // comma space delimitated list of names that correlate with above tokens

### Github

You will need to go into the repository of the service being continually deployed and add secret and public facing web address + /pullrequest as the address to post to on push and pull request events

### To run the client

A start script needs to be made for the deploy Edit the following command with the right env, token, and key and run it in bash (root of project) to start things up

    touch /config/kick_off_cd.sh && chmod +x /config/kick_off_cd.sh && echo " #!/bin/bash
    export ENVIRONMENT="local"
    export JITPLOY_SERVER=<ADDRESS_OF_YOUR_SERVER>
    export CONNECT_TOKEN=<TEST_TOKEN>
    export REPO_NAME=<NAME_OF_YOUR_SERVICES_REPO>
    export CONFIG_KEY=<CONFIG_KEY_FOR_THIS_ENV>
    node deploy.js
    " >> /config/kick_off_cd.sh && cd config/ && ./kick_off_cd.sh

if you need to change environment variables, do so in its decrypted_*.js file. You will need to write over the current encrypted_* file for that environment to commit to github. This can be done by running encrypt.js needs the config key used to decrypt. After editing the following template with proper key and env run it in the root of the project

    touch /config/crypt_all_the_things.sh && chmod +x crypt_all_the_things.sh && echo "#!/bin/bash
    export ENVS="local"
    export KEYS="<CONFIG_KEY>"
    node encrypt.js
    " >> /config/crypt_all_the_things.sh && cd config/ && ./crypt_all_the_things.sh
