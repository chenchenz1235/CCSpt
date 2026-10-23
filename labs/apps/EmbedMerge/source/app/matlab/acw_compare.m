function result=acw_compare(left,right,showUI)
% Official comparison only; original model files are never saved here.
result=struct('status','failed','version',version,'left',left,'right',right, ...
    'changes',{{}},'error','','viewer_opened',false,'model_merge_enabled',false);
try
    oldPath=path;cleanup=onCleanup(@()path(oldPath));
    addpath(fileparts(left));
    if showUI
        visdiff(left,right);result.status='viewer_opened';result.viewer_opened=true;return;
    end
    assert(~isempty(which('slxmlcomp.compare')),'This MATLAB release has no supported slxmlcomp.compare API. Use the official comparison window.');
    edits=slxmlcomp.compare(left,right);
    if ~isempty(edits)
        result.changes=walk(edits.LeftRoot,'left','');
        result.changes=[result.changes walk(edits.RightRoot,'right','')];
    end
    if isempty(result.changes)
        % R2024b Edits applies default filters. Keep a separate official,
        % unfiltered export before interpreting an empty visible difference tree.
        c=visdiff(left,right);filter(c,'unfiltered');
        folder=tempname(pwd);mkdir(folder);
        result.unfilteredReport=char(publish(c,OutputFolder=folder));
        result.reportFilter='unfiltered';
    end
    result.status='compared';
catch err,result.error=getReport(err,'extended','hyperlinks','off');end
end
function rows=walk(node,side,parent)
rows={};location=[parent '/' char(node.Name)];partner=node.Partner;
if isempty(partner)
    if node.Edited,rows{end+1}=struct('path',location,'side',side,'kind','unmatched','property','','left','','right','');end
elseif strcmp(side,'left')
    keys=unique([names(node.Parameters) names(partner.Parameters)]);
    changed=false;
    for k=1:numel(keys)
        a=parameter(node.Parameters,keys{k});b=parameter(partner.Parameters,keys{k});
        if ~isequal(a,b),changed=true;rows{end+1}=struct('path',location,'side',side,'kind','parameter','property',keys{k},'left',a,'right',b);end
    end
    if node.Edited && ~changed,rows{end+1}=struct('path',location,'side',side,'kind','structure','property','','left','','right','');end
end
children=node.Children;
for k=1:numel(children),if iscell(children),child=children{k};else,child=children(k);end;rows=[rows walk(child,side,location)];end
end
function keys=names(parameters)
keys={};for k=1:numel(parameters),if iscell(parameters),p=parameters{k};else,p=parameters(k);end;keys{end+1}=char(p.Name);end
end
function value=parameter(parameters,key)
value='';for k=1:numel(parameters),if iscell(parameters),p=parameters{k};else,p=parameters(k);end;if strcmp(char(p.Name),key),value=char(p.Value);return;end;end
end
