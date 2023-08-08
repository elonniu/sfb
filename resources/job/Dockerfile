FROM golang AS builder

WORKDIR /app

COPY . .
RUN go mod download
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w"

ENTRYPOINT /app/main

FROM alpine

RUN apk update && apk add chromium --no-cache

COPY --from=builder /app/main /app/main

ENTRYPOINT /app/main
