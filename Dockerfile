FROM oven/bun:1.1.30 AS base

WORKDIR /app
RUN bun install proxy-from-env


# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production
RUN chmod 644 /app/node_modules/proxy-from-env/

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# test & build
ENV NODE_ENV=production
RUN bun run build
RUN pwd && ls -la  # Add this line to print working directory and list contents

# copy production dependencies and source code into final image
FROM base AS potato
COPY --from=install /temp/prod/node_modules node_modules
RUN pwd && ls -la /app  # Add this line to list contents of /app
COPY --from=prerelease /app/plato plato
COPY --from=prerelease /app/dist dist
COPY --from=prerelease /app/package.json .

# Change ownership of the entire /app directory to the bun user
RUN chown -R bun:bun /app/node_modules


# Set the working directory
WORKDIR /app

# Switch to the bun user
USER bun

EXPOSE 8080/tcp

ENTRYPOINT [ "bun", "start" ]
