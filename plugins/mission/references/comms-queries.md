# Comms GraphQL Queries

## Thread Map Query

Fetches the review thread IDs and resolution status for a PR. Used in Step 2b
to build the thread map, and re-fetched in Step 8 for the done check.

```graphql
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100){
        nodes{
          id
          isResolved
          comments(first:1){nodes{databaseId}}
        }
      }
    }
  }
}
```

Invoke with:
```bash
gh api graphql \
  -f query='<query above>' \
  -f owner="$OWNER" -f name="$REPO_NAME" -F number="$PR_NUM"
```

Extract the thread map:
```bash
jq '.data.repository.pullRequest.reviewThreads.nodes |
    map({
      key: (.comments.nodes[0].databaseId | tostring),
      value: {thread_id: .id, is_resolved: .isResolved}
    }) | from_entries'
```

**Note:** `first:100` is the thread limit. PRs with more than 100 review threads
may produce an incomplete map — the done check (Step 8) may show false all-resolved.

---

## Done Check Query

Fetches whether all review threads are resolved. Used in Step 8.

```graphql
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviewThreads(first:100){
        nodes{
          isResolved
        }
      }
    }
  }
}
```

Invoke with:
```bash
gh api graphql \
  -f query='<query above>' \
  -f owner="$OWNER" -f name="$REPO_NAME" -F number="$PR_NUM"
```

Extract all-resolved:
```bash
jq '.data.repository.pullRequest.reviewThreads.nodes |
    length == 0 or all(.isResolved == true)'
```

**Note:** Same `first:100` limit applies. See Thread Map Query note above.

## Resolve Thread Mutation

Marks a single review thread as resolved. Used after actioning inline comments.

```graphql
mutation($tid:ID!){
  resolveReviewThread(input:{threadId:$tid}){
    thread{isResolved}
  }
}
```

Invoke with:
```bash
gh api graphql \
  -f query='<mutation above>' \
  -f tid="$THREAD_ID" > /dev/null
```
