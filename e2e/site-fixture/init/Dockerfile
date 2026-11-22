# e2e only: prepares the mfardiansyah.id test services (GeoIP file + site databases). Build context: e2e/site-fixture/init.
FROM golang:1.26.10-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/site-init .

FROM scratch
COPY --from=build /out/site-init /site-init
ENTRYPOINT ["/site-init"]
