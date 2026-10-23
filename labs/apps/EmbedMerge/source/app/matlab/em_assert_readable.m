function em_assert_readable(file)
% Inspect only the header. Do not mistake a protected container for bad MAT
% data or an unsupported script type. No decryption is attempted.
fid=fopen(file,'rb');
assert(fid>0,'EmbedMerge:ReadFailed','无法打开文件：%s',file);
cleanup=onCleanup(@()fclose(fid));
bytes=fread(fid,512,'*uint8');
if ~isempty(regexpi(char(bytes(:).'),'e-?safenet','once'))
    error('EmbedMerge:ProtectedContent','MATLAB 读取到 E-SafeNet 保护内容，尚未取得明文：%s。请核对 MATLAB 的公司读取授权；这不是文件类型不受支持。',file);
end
end
