import { h, Fragment, ListView, componentScope } from "harmaja";
import * as L from "lonna";
import { Board, BoardHistoryEntry, Id, Item, createBoard, getItemIds, getItemText, EventUserInfo } from "../../../common/src/domain";
import prettyMs from "pretty-ms"
import _ from "lodash";
import { ISODate } from "./recent-boards";
import { boardReducer, getItem } from "../../../common/src/state";

type ParsedHistoryEntry = {
    timestamp: ISODate,
    itemIds: Id[],
    user: EventUserInfo,
    kind: "added" | "moved into" | "renamed" | "deleted" | "changed"
    actionText: string // TODO: this should include links to items for selecting by click.
}

export const HistoryView = ({ history, board }: { history: L.Property<BoardHistoryEntry[]>, board: L.Property<Board>}) => {
    const expanded = L.atom(false)
    
    return <div className={L.view(expanded, e => e ? "history expanded" : "history")}>
        <span className="icon history" onClick={() => expanded.modify(e => !e)}/>
        {
            L.view(expanded, e => e && <HistoryTable/>)
        }      
    </div>

    function HistoryTable() {
        // Note: parsing full history once a second may or may not prove to be a performance challenge.
        // At least it's done only when the history table is visible and debounced with 1000 milliseconds.
        const parsedHistory = history.pipe(L.debounce(1000, componentScope()), L.map(parseFullHistory), L.map(clipHistory))
        return <>
            <h2>Change Log</h2>
            <table>
                <ListView observable={parsedHistory} getKey={i => i.timestamp} renderObservable={ renderHistoryEntry }/>
            </table>  
        </>
    }

    function renderHistoryEntry(key: string, entry: L.Property<ParsedHistoryEntry>) {
        return <tr className="row">
            <td className="timestamp">
                { L.view(entry, e => renderTimestamp(e.timestamp) ) }  
            </td>
            <td className="user">
                { L.view(entry, e => e.user.nickname) }
            </td>
            <td className="action">
            { L.view(entry, e => e.actionText) }
            </td>
        </tr>
    }

    function renderTimestamp(timestamp: ISODate) {
        const diff = new Date().getTime() - new Date(timestamp).getTime()
        if (diff < 1000) return "just now"
        return prettyMs(diff, {compact: true}) + " ago"
    }

    function clipHistory(history: ParsedHistoryEntry[]) {
        return history.reverse().slice(0, 100)
    }

    function parseFullHistory(history: BoardHistoryEntry[]): ParsedHistoryEntry[] {
        const init = {
            board: createBoard("tmp"),
            parsedHistory: [] as ParsedHistoryEntry[]
        }
        const { parsedHistory } = history.reduce(({ board, parsedHistory }, event) => { 
            const boardAfter = boardReducer(board, event)[0]
            const parsedEntry = parseHistory(event, board, boardAfter)
            const newHistory = parsedEntry !== null ? [...parsedHistory, parsedEntry] : parsedHistory
            return { board: boardAfter, parsedHistory: newHistory }
        }, init)
        return parsedHistory
    }

    function parseHistory(event: BoardHistoryEntry, boardBefore: Board, boardAfter: Board): ParsedHistoryEntry | null {
        const { timestamp, user } = event;
        const itemIds = getItemIds(event)
        switch (event.action) {
            case "item.add": {
                const containerIds = [...new Set(event.items.map(i => i.containerId))]
                const containerInfo = containerIds.length === 1 && containerIds[0] && ` to ${describeItems([getItem(boardBefore)(containerIds[0])])}` || ""
                return { timestamp, user, itemIds, kind: "added", actionText: `added ${describeItems(event.items)}${containerInfo}`}
            }
            case "item.delete": return { timestamp, user, itemIds, kind: "deleted", actionText: "deleted " + describeItems(itemIds.map(getItem(boardBefore))) }
            case "item.front": return null
            case "item.move": {
                const containerChanged = event.items.some(i => i.containerId !== getItem(boardBefore)(i.id).containerId)
                const containerIds = event.items.map(i => i.containerId)
                const containerId = containerIds[0]
                const sameContainer = new Set(containerIds).size === 1
                if (containerId && containerChanged && sameContainer) {
                    return { timestamp, user, itemIds, kind: "moved into", actionText: `moved ${describeItems(itemIds.map(getItem(boardBefore)))} to ${ describeItems([getItem(boardBefore)(containerId)])}` }
                } else {
                    return null
                }
            }
            case "item.update": {
                if (event.items.length === 1) {
                    const itemId = event.items[0].id
                    const itemBefore = getItem(boardBefore)(itemId)
                    const itemAfter = getItem(boardAfter)(itemId)
                    const textBefore = getItemText(itemBefore)
                    const textAfter = getItemText(itemAfter)
                    if (textBefore !== textAfter) {
                        return { timestamp, user, itemIds, kind: "renamed", actionText: `renamed ${describeItems([itemBefore])} to ${textAfter}` }
                    } else {
                        return null // Ignore all the resizes, recolorings...
                    }
                }
                return {timestamp, user, itemIds, kind: "changed", actionText: `changed ${describeItems(event.items)}` }
            }
        }
    }

    function describeItems(items: Item[]): string {
        if (items.length > 1) return "multiple items"
        const item = items[0]
        switch (item.type) {
            case "note": 
            case "container":
            case "text": return item.text // TODO: fold creation and consecutive renames
            case "image": return "an image"
        }
    }
}