require('dotenv').config()
const axios = require('axios')
const { exception } = require('console');
const { knownExtended } = require('tar');
var knex = require('knex')({
    client: 'sqlite3',
    connection: {
        filename: "./defi-gov-watch_db.sqlite"
    }
});

const subgrapBaseUrl = 'https://api.thegraph.com/subgraphs/name'
const subgraphs = { 'uniswap': '/ianlapham/uniswapv2', 'curve': '/aragon/aragon-mainnet' }

const hubBaseUrl = 'https://hub.snapshot.page/api'
const hubs = { 'spaces': '/spaces', 'proposals': '/proposals', 'proposal': '/proposal/' }

const tgBaseUrl = `https://api.telegram.org/bot${process.env.TG_BOT_API_KEY}`
const tgActions = { 'send': '/sendMessage', 'update': '/getUpdates' }

const queryInterval = 60 * 5 //seconds

//#region classes
class Space {
    constructor(id, name, network, symbol, createdAt = Date.now(), isWatched = false) {
        this.id = id;
        this.name = name;
        this.network = network;
        this.symbol = symbol;
        this.createdAt = createdAt;
        this.isWatched = isWatched
    }
}
class Proposal {
    constructor(id, space, address, start, end, name, body, createdAt = Date.now(), isWatched = false) {
        this.id = id
        this.space = space
        this.address = address
        this.start = start
        this.end = end
        this.name = name
        this.body = body
        this.createdAt = createdAt
        this.isWatched = isWatched
    }
}
class ProposalChoice {
    constructor(id, proposal, name, order, createdAt = Date.now()) {
        this.id = id
        this.proposal = proposal
        this.name = name
        this.order = order
        this.createdAt = createdAt
    }
}
class VoteCount {
    constructor(id, proposalChoice, count, createdAt = Date.now(), tempChoice = null) {
        this.id = id
        this.proposalChoice = proposalChoice
        this.count = count
        this.createdAt = createdAt
        this.tempChoice = tempChoice
    }
}
class Alert {
    constructor(title, body) {
        this.title = title
        this.body = body
    }
}
//#endregion

//#region db init
knex.schema.hasTable('networks').then(function (exists) {
    if (!exists) {
        const res = knex.schema.createTable('networks', function (t) {
            t.int('id').primary();
            t.int('name');
            t.dateTime('createdAt');
        });
        knex('networks').insert(
            { id: 1, name: 'Ethereum mainnet' },
            { id: 56, name: 'Binance smart chain' },
            { id: 4, name: 'Ethereum Rinkeby' },
            { id: 100, name: 'xDai' },
            { id: 42, name: 'Ethereum Kovan' },
            { id: 7, name: 'ThaiChain' },
            { id: 61, name: 'Ethereum Classic mainnet' },
            { id: 97, name: 'Binance smart chain testnet' },
            { id: 137, name: 'Matic Mainnet' },
            { id: 420, name: 'Optimistic Ethereum' },
            { id: 32659, name: 'Fusion mainnet' },
            { id: 80001, name: 'Matic Mumbai' },
        )
        return res;
    }
});
knex.schema.hasTable('spaces').then(function (exists) {
    if (!exists) {
        return knex.schema.createTable('spaces', function (t) {
            t.string('id').primary();
            t.string('name');
            t.int('network').references('networks.id');
            t.string('symbol');
            t.dateTime('createdAt');
            t.boolean('isWatched');
        });
    }
});
knex.schema.hasTable('proposals').then(function (exists) {
    if (!exists) {
        return knex.schema.createTable('proposals', function (t) {
            t.string('id').primary();
            t.int('space').references('spaces.id')
            t.string('address');
            t.dateTime('start');
            t.dateTime('end');
            t.string('name')
            t.text('body')
            t.dateTime('createdAt');
            t.boolean('isWatched');
        });
    }
});
knex.schema.hasTable('proposalChoices').then(function (exists) {
    if (!exists) {
        return knex.schema.createTable('proposalChoices', function (t) {
            t.increments('id').primary();
            t.int('proposal').references('proposals.id');
            t.string('name');
            t.int('order');
            t.dateTime('createdAt');
        });
    }
});
knex.schema.hasTable('voteCounts').then(function (exists) {
    if (!exists) {
        return knex.schema.createTable('voteCounts', function (t) {
            t.increments('id').primary();
            t.int('proposalChoice').references('proposalChoices.id')
            t.int('count');
            t.dateTime('createdAt');
        });
    }
});
//#endregion

//#region db accessors
const getSnapshotSpaces = async () => {
    const res = knex('spaces').select()
    if (res.length > 0)
        return res.map(x => new Space(x.id, x.name, x.network, x.symbol, x.createdAt, x.isWatched))
    return res
}
const addSnapshotSpace = async (pSpace) => {
    const res = knex('spaces').insert({
        id: pSpace.id,
        name: pSpace.name,
        network: pSpace.network,
        symbol: pSpace.symbol,
        createdAt: pSpace.createdAt,
        isWatched: pSpace.isWatched
    })
    return res
}
const delSnapshotSpace = async (pSpace) => {
    const res = knex('spaces').where('id', pSpace.id).del()
    return res
}
const getWatchedSpaces = async () => {
    const res = knex('spaces').where('isWatched', true).select()
    if (res.length > 0)
        return res.map(x => new Space(x.id, x.name, x.network, x.symbol, x.createdAt, x.isWatched))
    return res
}
const getSnapshotProposals = async (pSpace = null) => {
    const res = pSpace ? knex('proposals').where('space', pSpace.id).select() : knex('proposals').select()
    if (res.length > 0)
        return res.map(x => new Proposal(x.id, x.space, x.address, x.start, x.end, x.name, x.body, x.createdAt, x.isWatched))
    return res
}
const addSnapshotProposal = async (pProposal) => {
    const res = knex('proposals').insert({
        id: pProposal.id,
        space: pProposal.space,
        address: pProposal.address,
        start: pProposal.start,
        end: pProposal.end,
        name: pProposal.name,
        body: pProposal.body,
        createdAt: pProposal.createdAt,
        isWatched: pProposal.isWatched
    })
    return res
}
const delSnapshotProposal = async (pProposal) => {
    const res = knex('proposals').where('id', pProposal.id).del()
    return res
}
const getWatchedProposals = async () => {
    const res = knex('proposals').where('isWatched', true).select()
    if (res.length > 0)
        return res.map(x => new Proposal(x.id, x.space, x.address, x.start, x.end, x.name, x.body, x.createdAt, x.isWatched))
    return res
}
const getSnapshotProposalChoices = async (pProposal = null) => {
    const res = pProposal ? knex('proposalChoices').where('proposal', pProposal.id).select() : knex('proposalChoices').select()
    if (res.length > 0)
        return res.map(x => new ProposalChoice(x.id, x.proposal, x.name, x.order, x.createdAt))
    return res
}
const addSnapshotProposalChoice = async (pProposalChoice) => {
    const res = knex('proposalChoices').insert({
        proposal: pProposalChoice.proposal,
        name: pProposalChoice.name,
        order: pProposalChoice.order,
        createdAt: pProposalChoice.createdAt,
    })
    return res
}
const delSnapshotProposalChoice = async (pProposalChoice) => {
    const res = knex('proposalChoices').where('id', pProposalChoice.id).del()
    return res
}
const getVoteCount = async (pProposalChoice = null, pIslastOnly = false) => {
    try {
        let res = []
        if (pProposalChoice && pIslastOnly) {
            res = await knex('voteCounts').where('proposalChoice', pProposalChoice.id).orderBy('createdAt', 'desc').limit(1).select()
        } else if (pProposalChoice) {
            res = await knex('voteCounts').where('proposalChoice', pProposalChoice.id).select()
        } else if (pIslastOnly) {
            res = await knex('voteCounts').orderBy('createdAt', 'desc').limit(1).select()
        } else {
            res = await knex('voteCounts').select()
        }
        if (res.length > 0)
            return res.map(x => new VoteCount(x.id, x.proposalChoice, x.count, new Date(x.createdAt)))
        return res
    } catch (e) {
        throw new exception("Error getting VoteCount from db", e)
    }
}
const addVoteCount = async (pVoteCount) => {
    const res = knex('voteCounts').insert({
        proposalChoice: pVoteCount.proposalChoice,
        count: pVoteCount.count,
        createdAt: pVoteCount.createdAt,
    })
    return res
}
const delVoteCount = async (pVoteCount) => {
    const res = knex('voteCounts').where('id', pVoteCount.id).del()
    return res
}
//#endregion

//#region Remote fetches
const fetchSnashotSpaces = async () => {
    try {
        const res = await axios.get(hubBaseUrl + hubs['spaces'])

        const spaces = []
        for (const resItem in res.data) {
            spaces.push(new Space(resItem,
                res.data[resItem].name,
                res.data[resItem].network,
                res.data[resItem].symbol))
        }
        return spaces
    }
    catch (e) {
        console.error("Error fetching Spaces", e)
    }
}
const fetchSnapshotProposals = async (pSpace) => {
    try {
        const res = await axios.get(hubBaseUrl + '/' + pSpace.id + hubs['proposals'])

        const proposals = []
        for (const resItem in res.data) {
            proposals.push(new Proposal(resItem,
                pSpace.id,
                res.data[resItem].address,
                new Date(res.data[resItem].msg.payload.start * 1000),
                new Date(res.data[resItem].msg.payload.end * 1000),
                res.data[resItem].msg.payload.name,
                res.data[resItem].msg.payload.body))
        }
        return proposals
    }
    catch (e) {
        console.error("Error fetching Proposals", e)
    }
}
const fetchSnashotProposalChoices = async (pProposal) => {
    try {
        const res = await axios.get(hubBaseUrl + '/' + pProposal.space + hubs['proposals'])
        const proposalChoices = []
        for (let item in res.data) {
            if (item == pProposal.id) {
                res.data[item].msg.payload.choices.forEach((x, i) => {
                    proposalChoices.push(new ProposalChoice(
                        null,
                        pProposal.id,
                        x,
                        i + 1,
                    ))
                })
            }
        }

        return proposalChoices;
    }
    catch (e) {
        console.error('Error Fetching Proposal Choices', e)
    }
}
const fetchSnashotVoteCounts = async (pProposal) => {
    try {
        const res = await axios.get(hubBaseUrl + '/' + pProposal.space + hubs['proposal'] + pProposal.id)
        const votes = []
        const voteCounts = []

        for (item in res.data) {
            if (res.data[item].msg.type === 'vote') {
                const vote = res.data[item].msg.payload.choice

                votes[vote] = votes[vote] ? votes[vote] + 1 : 1
            }
        }

        for (let vote in votes) {
            if (vote != undefined) {
                voteCounts.push(new VoteCount(null, null, votes[vote], Date.now(), vote))
            }
        }

        return voteCounts;
    }
    catch (e) {
        console.error('Error Fetching Proposal Choices', e)
    }
}
//#endregion

//#region Alerts
const sendAlert = async (pAlert) => {
    consoleAlert(pAlert);
    tgAlert(pAlert);
}
const tgAlert = async (pAlert) => {
    const res = await axios.post(tgBaseUrl + tgActions['send'], {
        'chat_id': process.env.TG_CHAT_ID,
        'text': pAlert.title + '\n\n' + pAlert.body
    })
    return res
}
const consoleAlert = async (pAlert) => {
    console.log(pAlert.title, pAlert.body)
}
//#endregion

//#region Logic
const updateSnapshotSpaces = async () => {
    // Fetch the spaces from remote
    const spaces = await fetchSnashotSpaces()

    // Get the existing Spaces from DB
    const existingSpaces = await getSnapshotSpaces()

    //Compare
    const addedSpaces = spaces.filter(x => !existingSpaces.map(y => y.id).includes(x.id));
    const removedSpaces = existingSpaces.filter(x => !spaces.map(y => y.id).includes(x.id));

    //Alert and add new spaces
    if (addedSpaces.length > 0) {
        sendAlert(new Alert(`Found ${addedSpaces.length} recently added space(s)`, `${addedSpaces.map(x => x.name).join(', ')}`));
        addedSpaces.forEach(async x => await addSnapshotSpace(x))
    }
    //Alert and remove old spaces
    if (removedSpaces.length > 0) {
        sendAlert(new Alert(`Found ${removedSpaces.length} recently removed space(s)`, `${removedSpaces.map(x => x.name).join(', ')}`));
        removedSpaces.forEach(async x => await delSnapshotSpace(x))
    }
}

const updateProposals = async (pSpace) => {
    //Fetch the proposals from remote
    const proposals = await fetchSnapshotProposals(pSpace)

    //Get the existing Proposals from DB
    const existingProposals = await getSnapshotProposals(pSpace)

    //Compare
    const addedProposals = proposals.filter(x => !existingProposals.map(y => y.id).includes(x.id));
    const removedProposals = existingProposals.filter(x => !proposals.map(y => y.id).includes(x.id));

    //Alert and add new proposals
    if (addedProposals.length > 0) {
        sendAlert(new Alert(`Found ${addedProposals.length} recently added proposal(s) for ${pSpace.name}`, `${addedProposals.map(x => x.name).join(',\n')}`));
        for (let addedProposal of addedProposals) {
            await addSnapshotProposal(addedProposal)
            await updateProposalChoices(addedProposal)
        }
    }

    //Alert and remove old proposals
    if (removedProposals.length > 0) {
        sendAlert(new Alert(`Found ${removedProposals.length} recently removed proposal(s) for ${pSpace.name}`, `${removedProposals.map(x => x.name).join(',\n')}`));
        removedProposals.forEach(async x => await delSnapshotProposal(x))
    }

}

const updateProposalChoices = async (pProposal) => {
    //Fetch remote proposalChoices
    const proposalChoices = await fetchSnashotProposalChoices(pProposal)

    //Insert db
    proposalChoices.forEach(async x => await addSnapshotProposalChoice(x))
}
const updateVoteCounts = async (pProposal) => {
    //Fetch remote voteCounts
    const newVoteCounts = await fetchSnashotVoteCounts(pProposal)
    //Get proposalChoices from db
    const proposalChoices = await getSnapshotProposalChoices(pProposal)

    //Typically 1 voteCount per proposalChoice
    for (let newVoteCount of newVoteCounts) {
        //Match the voteCount to it's proposalChoice
        const proposalChoice = proposalChoices.filter(x => x.order == newVoteCount.tempChoice)[0]
        //If we don't have proposalChoices for the current proposal, update them and they will be voteCounted on the next run
        if (!proposalChoice) {
            // await updateProposalChoices(pProposal)
            return
        }

        //Replace the tempChoice with the actual proposalChoice (snapshot uses the order of the choice as it's Id)
        newVoteCount.proposalChoice = proposalChoice.id

        //Look for the last votesCounts on this proposalChoice
        const existingProposalChoiceVoteCounts = await getVoteCount(proposalChoice, true)

        //If there is none, or the count is different, add ours
        if (existingProposalChoiceVoteCounts.length < 1 || newVoteCount.count !== existingProposalChoiceVoteCounts[0].count) {
            addVoteCount(newVoteCount)
        }
    }
};
//#endregion

(async () => {
    try {
        setInterval(async () => {
            updateSnapshotSpaces();

            const spaces = await getWatchedSpaces();
            for (let space of spaces) {
                updateProposals(space);
            }

            const watchedProposals = await getWatchedProposals();
            for (let proposal of watchedProposals) {
                updateVoteCounts(proposal);
            }

            //Proposals that just ended

            //Proposals that end soon

            //Proposals that just reached quorum

            //Proposals that changed by % over threshold

            //Proposals that ...

        }, queryInterval * 1000)

    } catch (e) {
        console.error(e)
    }
})();