FROM public.ecr.aws/elonniu/rust:latest AS builder

WORKDIR /app

COPY . .
RUN cargo build --release
RUN strip target/release/job

ENTRYPOINT /app/target/release/job

FROM alpine

COPY --from=builder /app/target/release/job /app/target/release/job

RUN apk add --no-cache libgcc

ENTRYPOINT /app/target/release/job
