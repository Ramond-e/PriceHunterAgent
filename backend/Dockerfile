FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore dependencies (layer caching)
COPY PriceHunterAgent/*.csproj ./PriceHunterAgent/
RUN dotnet restore ./PriceHunterAgent/PriceHunterAgent.csproj

# Build and publish
COPY PriceHunterAgent/ ./PriceHunterAgent/
RUN dotnet publish ./PriceHunterAgent/PriceHunterAgent.csproj \
    -c Release \
    -o /app/publish \
    --no-restore

# Runtime image
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:5000
EXPOSE 5000

ENTRYPOINT ["dotnet", "PriceHunterAgent.dll"]
