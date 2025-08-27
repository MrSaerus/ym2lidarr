export const getRootFolders = jest.fn(async () => [{ path: '/music', defaultQualityProfileId: 1, defaultMetadataProfileId: 2 }]);
export const getQualityProfiles = jest.fn(async () => [{ id: 1, name: 'Default' }]);
export const getMetadataProfiles = jest.fn(async () => [{ id: 2, name: 'Default' }]);
export const ensureArtistInLidarr = jest.fn(async () => ({ id: 123, title: 'ok', __action: 'created' }));
export const ensureAlbumInLidarr = jest.fn(async () => ({ id: 456, title: 'ok', __action: 'created' }));
export const testLidarr = jest.fn(async () => ({ ok: true, status: 200, data: { version: '1.0.0' } }));
