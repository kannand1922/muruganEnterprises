# Stock Reset API Commands

## Notes
- Current behavior: stock comparison uses master CSV `shop` column for all locations.
- Future plan: switch source logic when DBF integration is added.

## Reset Unfinished Table (all cycles)
```bash
curl -X POST http://localhost:3100/api/stock/unfinished/reset -H "Content-Type: application/json" -d '{}'
```

## Reset Finished Table (specific cycle)
```bash
curl -X POST http://localhost:3100/api/stock/finished/reset -H "Content-Type: application/json" -d '{"cycleId":1}'
```

## Reset Cycle Product Events (all)
```bash
curl -X POST http://localhost:3100/api/stock/events/reset -H "Content-Type: application/json" -d '{}'
```

## Reset Cycle Product Events (specific cycle/location)
```bash
curl -X POST http://localhost:3100/api/stock/events/reset -H "Content-Type: application/json" -d '{"cycleId":1,"shopLocationId":2}'
```
