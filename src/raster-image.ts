export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
export const IMAGE_UPLOAD_LIMIT = 10 * 1024 * 1024;

export async function readImageFile(file: File): Promise<{ file: File; width: number; height: number }> {
    if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_UPLOAD_LIMIT) throw new Error('Unsupported image file');
    const image = await decodeImage(file);
    try {
        if (image.width * image.height > 40_000_000) throw new Error('The image resolution exceeds the limit');
        if (file.type !== 'image/svg+xml') return { file, width: image.width, height: image.height };
        const blob = await rasterImage(image);
        const raster = new File([blob], `${file.name.replace(/\.[^.]*$/, '')}.png`, { type: 'image/png' });
        if (raster.size > IMAGE_UPLOAD_LIMIT) throw new Error('The image exceeds the upload limit');
        return { file: raster, width: image.width, height: image.height };
    } finally {
        URL.revokeObjectURL(image.src);
    }
}

export async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob),
        image = new Image();
    image.src = url;
    try {
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000)
            throw new Error('Invalid image resolution');
        return image;
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
}

export async function rasterImage(image: HTMLImageElement): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable');
    context.drawImage(image, 0, 0);
    return new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image conversion failed'))), 'image/png'),
    );
}
