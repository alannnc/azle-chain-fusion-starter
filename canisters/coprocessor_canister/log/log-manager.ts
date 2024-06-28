import { Null, Record, StableBTreeMap, Variant, nat } from "azle";
import { getUint } from "ethers";

import { LogEntry } from "@bundly/ic-evm-rpc";

import { CoprocessorService } from "../coprocessor/coprocessor.service";
import { EtherRpcService } from "../ether/ether-rpc.service";
import { Event, EventService } from "../event/event.service";
import { fibonacci } from "../helpers";

const LogToProcess = Record({
  log: LogEntry,
  eventId: nat,
  status: Variant({ Pending: Null, Processed: Null }),
});
type LogToProcess = typeof LogToProcess.tsType;

const logsToProcess = StableBTreeMap<nat, LogToProcess>(10);

export class LogManager {
  constructor(private eventService: EventService) {}

  public async getLogs() {
    const events = this.eventService.getAll();

    for (let [eventId, event] of events) {
      const service = new EtherRpcService(event.service);

      const coprocessor = new CoprocessorService(service, event.addresses);

      const getLogsArgs = {
        fromBlock: event.lastScrapedBlock,
        toBlock: event.lastScrapedBlock + CoprocessorService.MAX_BLOCK_SPREAD,
        addresses: event.addresses,
        topics: event.topics.Some || [],
      };

      const getLogsResponse = await coprocessor.getLogs(getLogsArgs);

      if (getLogsResponse.Consistent?.Ok) {
        const logs = getLogsResponse.Consistent.Ok;

        const filteredLogs = logs.filter((log) => {
          const blockNumber = log.blockNumber.Some;

          if (blockNumber !== undefined) {
            return log.blockNumber.Some !== event.lastScrapedBlock;
          }

          // TODO: What happens if blockNumber is not present?
          return true;
        });

        if (filteredLogs.length > 0) {
          let maxBlock = event.lastScrapedBlock;

          for (const log of filteredLogs) {
            const currentBlockNumber = log.blockNumber.Some;
            if (currentBlockNumber && currentBlockNumber > maxBlock) {
              maxBlock = currentBlockNumber;
            }
          }

          if (filteredLogs.length > 0) {
            this.saveLogs(filteredLogs, eventId);
            this.eventService.update(eventId, { ...event, lastScrapedBlock: maxBlock });
          }
        }
      }
    }
  }

  private saveLogs(logs: LogEntry[], eventId: nat) {
    logs.forEach((log) => {
      const nextId = logsToProcess.len() + 1n;
      logsToProcess.insert(nextId, { log, eventId, status: { Pending: null } });
    });
  }

  private async processJobEvent(event: Event, jobId: bigint): Promise<string> {
    // this calculation would likely exceed an ethereum blocks gas limit
    // but can easily be calculated on the IC
    const result = fibonacci(20);
    const service = new EtherRpcService(event.service);
    const coprocessor = new CoprocessorService(service, event.addresses);
    return coprocessor.callback(result.toString(), jobId);
  }

  public async processLogs() {
    const pendingLogs = logsToProcess.items().filter(([_, value]) => value.status.Pending !== undefined);

    for (const [key, value] of pendingLogs) {
      const event = this.eventService.get(value.eventId).Some;

      if (event === undefined) {
        throw new Error("Event not found");
      }

      // Topic 1 is the jobId
      const jobId = getUint(value.log.topics[1]);

      console.log("Processing log", key, "jobId", jobId);

      try {
        const result = await this.processJobEvent(event, jobId);
        console.log("Job processed", jobId, "result", result);
        logsToProcess.insert(key, { ...value, status: { Processed: null } });
      } catch (error) {
        console.error("Error processing log", error);
        throw new Error("Error processing log");
      }
    }
  }
}
