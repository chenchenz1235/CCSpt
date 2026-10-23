function em_view_compare(left,right,output)
% Official viewer request in a reusable R2024b Automation server. No base
% workspace variables are assigned, no model files are saved by this helper.
persistent sessionId
if isempty(sessionId),sessionId=char(java.util.UUID.randomUUID);end
try
    assert(strcmp(version('-release'),'2024b'),'This adapter requires MATLAB R2024b');
    em_assert_readable(left);em_assert_readable(right);
    visdiff(left,right);drawnow;
    r=struct('status','viewer_requested','sessionId',sessionId,'release',version('-release'),'matlabRoot',matlabroot,'compile','not_run','simulation','not_run','note','Official visdiff returned; no-differences may show a message instead of a tree');
catch err
    r=struct('status','failed','error',getReport(err,'extended','hyperlinks','off'),'sessionId',sessionId,'matlabRoot',matlabroot);
end
fid=fopen(output,'w','n','UTF-8');assert(fid>0);cleanup=onCleanup(@()fclose(fid));fprintf(fid,'%s',jsonencode(r));
end
