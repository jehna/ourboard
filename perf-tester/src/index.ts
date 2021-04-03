import { sleep } from "../../common/src/sleep"
import { newNote, Point } from "../../common/src/domain"
import MessageQueue from "../../frontend/src/store/message-queue"
import WebSocket from "ws"
import _ from "lodash"

// hack, sue me
// @ts-ignore
global.localStorage = {}

function add(a: Point, b: Point) {
    return { x: a.x + b.x, y: a.y + b.y }
}

function createTester(nickname: string, boardId: string) {
    let counter = 0
    const center = { x: 10 + Math.random() * 60, y: 10 + Math.random() * 40 }
    const radius = 10 + Math.random() * 10
    const increment = Math.random() * 4 - 2

    let [socket, messageQueue] = initSocket()

    async function reconnect(reconnectSocket: WebSocket) {
        await sleep(1000)
        if (reconnectSocket === socket) {
            console.log("reconnecting...")
            ;[socket, messageQueue] = initSocket()
        }
    }
    function initSocket() {
        let ws: WebSocket
        const WS_ADDRESS = `${DOMAIN ? "wss" : "ws"}://${DOMAIN ?? "localhost:1337"}/socket/board/${boardId}`
        ws = new WebSocket(WS_ADDRESS)

        ws.addEventListener("error", (e) => {
            console.error("Web socket error")
            reconnect(ws)
        })
        ws.addEventListener("open", () => {
            console.log("Websocket connected")
            messageQueue.onConnect()
            console.log("Joining board " + boardId)
            messageQueue.enqueue({ action: "board.join", boardId })
        })
        ws.addEventListener("message", (str) => {
            const event = JSON.parse(str.data)
            if (event.action === "ack") {
                messageQueue.ack()
            } else {
                if (event.action === "board.init") {
                    setInterval(() => {
                        counter += increment
                        const position = add(center, {
                            x: radius * Math.sin(counter / 100),
                            y: radius * Math.cos(counter / 100),
                        })
                        messageQueue.enqueue({ action: "cursor.move", position, boardId })
                        if (Math.random() < notesPerInterval)
                            messageQueue.enqueue({
                                action: "item.add",
                                boardId,
                                items: [newNote("NOTE " + counter, "black", position.x, position.y)],
                            })
                    }, interval)
                }
                if (event.action === "board.join.ack") {
                    messageQueue.enqueue({ action: "nickname.set", nickname })
                }
            }
        })

        ws.addEventListener("close", () => {
            console.log("Socket disconnected")
            reconnect(ws)
        })
        return [ws, MessageQueue(ws, undefined)] as const
    }
}

const kwargs = process.argv.slice(2)

const ACCEPTED_KWARGS = ["--userCount", "--boardId"]

const parsedKwargs: { userCount?: number; boardId?: string } = {}

for (let i = 0; i < kwargs.length - 1; i += 2) {
    const [argName, argValue] = [kwargs[i], kwargs[i + 1]]
    if (!ACCEPTED_KWARGS.includes(argName)) {
        throw Error(`Invalid argument ${argName}, expecting one or more of: ${ACCEPTED_KWARGS.join(", ")}`)
    }

    if (!argValue || argValue.startsWith("--")) {
        throw Error(`Invalid value for ${argName}, got ${argValue}`)
    }

    const argNameStripped = argName.slice(2)

    if (argNameStripped === "userCount") {
        const argValueParsed = Number(argValue)
        if (!Number.isInteger(argValueParsed)) {
            throw Error(`Expected integer value for userCount, got ${argValue}`)
        }
        parsedKwargs[argNameStripped] = argValueParsed
    } else if (argNameStripped === "boardId") {
        parsedKwargs[argNameStripped] = argValue
    }
}

// Environment variables.
const USER_COUNT = parseInt(process.env.USER_COUNT ?? "10")
const BOARD_ID = process.env.BOARD_ID
if (!BOARD_ID) {
    throw Error("BOARD_ID missing. Please specify one more board ids separated by comma (,)")
}
const BOARD_IDS = BOARD_ID.split(",")
const DOMAIN = process.env.DOMAIN

const NOTES_PER_SEC = parseFloat(process.env.NOTES_PER_SEC ?? "0.1")
const CURSOR_MOVES_PER_SEC = parseFloat(process.env.CURSOR_MOVES_PER_SEC ?? "10")

// Calculated vars
const interval = 1000 / CURSOR_MOVES_PER_SEC
const notesPerInterval = (NOTES_PER_SEC / 1000) * interval
console.log(
    `Starting ${USER_COUNT} testers, moving cursors ${CURSOR_MOVES_PER_SEC}/sec, creating notes ${NOTES_PER_SEC}`,
)
console.log(`Total cursor events ${CURSOR_MOVES_PER_SEC * USER_COUNT}/s`)
console.log(`Total creation events ${NOTES_PER_SEC * USER_COUNT}/s`)

for (let i = 0; i < USER_COUNT; i++) {
    createTester("perf-tester-" + (i + 1), BOARD_IDS[i % BOARD_IDS.length])
}
