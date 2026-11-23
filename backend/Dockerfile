# Brain Town API: static Go binary on scratch. Build context is ./backend.
FROM golang:1.23-alpine AS build
RUN apk add --no-cache ca-certificates
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/braintown ./cmd/braintown

FROM scratch
# CA bundle: the feed puller fetches https feeds (site, Animora); scratch has none.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/braintown /braintown
USER 65534:65534
EXPOSE 8081
ENTRYPOINT ["/braintown"]
