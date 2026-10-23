function r=em_read_native(source,output)
% Company-authorized native fopen only. No protection changes or bypass.
r=struct('status','failed','source','MATLAB fopen/fread','error','');
try
    f=fopen(source,'rb');assert(f>=0,'Cannot open source');c=onCleanup(@()fclose(f));
    bytes=fread(f,4*1024*1024+1,'*uint8');assert(numel(bytes)<=4*1024*1024,'Text exceeds 4 MiB');clear c;
    f=fopen(output,'wb');assert(f>=0,'Cannot open output');c=onCleanup(@()fclose(f));
    assert(fwrite(f,bytes,'uint8')==numel(bytes),'Incomplete cache write');clear c;
    r.status='read';r.bytes=numel(bytes);r.output=output;
catch err,r.error=getReport(err,'extended','hyperlinks','off');end
end
