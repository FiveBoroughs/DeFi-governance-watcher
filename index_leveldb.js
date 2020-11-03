require('dotenv').config()
const axios = require('axios')
const { exception } = require('console')
var level = require('level')

const db = level('db_defi-governance-watcher')

const subgrapBaseUrl = 'https://api.thegraph.com/subgraphs/name/'
const subgraphs = { 'unswap': 'ianlapham/uniswapv2', 'curve': 'aragon/aragon-mainnet' }

const hubBaseUrl = 'https://hub.snapshot.page/api/'
const hubs = { 'spaces': 'spaces' }

const queryInterval = 5 //seconds

//#region classes

class Space {
    constructor(id, token, name, network, symbol, createdAt = Date.now(), watched = false) {
        this.id = id;
        this.token = token;
        this.name = name;
        this.network = network;
        this.symbol = symbol;
        this.createdAt = createdAt;
        this.watched = watched
    }
}
//#endregion

//#region db getsetters

const getSnapshotSpaces = async () => {
    try {
        const res = JSON.parse(await db.get('spaces'))
        if (Object.entries(res).length > 0)
            return res.map(x => new Space(x.id, x.token, x.name, x.network, x.symbol, x.createdAt))
        return res
    }
    catch (e) {
        if (e.type === 'NotFoundError') {
            await db.put('spaces', '[]')
            console.log('Key created')
            return {};
        }
        throw e;
    }
}
const addSnapshotSpace = async (pSpace) => {
    const spaces = await getSnapshotSpaces();
    if (spaces.some(x => x.id == pSpace.id ||
        (x.token == pSpace.token)))
        throw exception('Duplicate Space')

    spaces.push(pSpace)

    await db.put('spaces', JSON.stringify(spaces))
}
const delSnapshotSpace = async (pSpace) => {
    const spaces = await getSnapshotSpaces();

    const newSpaces = spaces.filter(x => x.id != spaces.id)
    if (newSpaces.length == spaces.length)
        throw exception('Could not find Space')

    await db.put('spaces', JSON.stringify(newSpaces))
}

//#endregion

const fetchSnashotSpaces = async () => {
    try {
        const res = await axios.get(hubBaseUrl + hubs['spaces'])

        const spaces = []
        for (const resItem in res.data) {
            spaces.push(new Space(resItem,
                res.data[resItem].token,
                res.data[resItem].name,
                res.data[resItem].network,
                res.data[resItem].symbol))
        }
        return spaces
    }
    catch (e) {
        throw new exception("Error fetching Spaces", e)
    }
}


    ;
(async () => {
    try {
        setInterval(async () => {
            // Fetch the spaces from remote
            const spaces = await fetchSnashotSpaces()
            console.log(spaces)

            // Get the existing Spaces from DB
            const existingSpaces = await getSnapshotSpaces()
            console.log(existingSpaces)

            //Compare
            const addedSpaces = spaces.filter(x =>
                //If we have no spaces, they are all new
                Object.entries(existingSpaces).length === 0 ||
                //The spaces not in existingSpaces
                existingSpaces.map(y => y.id).includes(x.id));
            const removesSpaces = Object.entries(existingSpaces).length === 0 ? {} : existingSpaces.filter(x => spaces.map(y => y.id).includes(x.id));

            if (addedSpaces.length > 0) {
                console.log(`Found ${addedSpaces.length} recently added space(s) : ${addedSpaces.map(x => x.name).join(', ')}`);
                addedSpaces.forEach(async x => await addSnapshotSpace(x))
            }
            if (removesSpaces.length > 0)
                console.log(`Found ${removedSpaces.length} recently removed space(s) : ${removedSpaces.map(x => x.name).join(', ')}`);

        }, queryInterval * 1000)

    } catch (e) {
        console.error(e)
    }
})();